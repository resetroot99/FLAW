import type {
  Finding, SmellHit, CategoryScore, SmellIndex, AuditSummary, Gate,
  Rating, AuditStatus, SmellLevel, CategoryStatus, CATEGORIES,
  FingerprintHit,
} from '../types/index.js';
import { CATEGORIES as CATS } from '../types/index.js';
import { computeFingerprints } from '../analyzers/smell-fingerprint.js';

const SEVERITY_PENALTY: Record<string, number> = {
  critical: 12,
  high: 7,
  medium: 4,
  low: 1,
  info: 0,
};

const CONFIDENCE_MULT: Record<string, number> = {
  high: 1.0,
  medium: 0.75,
  low: 0.5,
};

export function computeCategoryScores(findings: Finding[]): CategoryScore[] {
  return CATS.map(cat => {
    const catFindings = findings.filter(f => f.categoryId === cat.id && f.status === 'open');
    let penalty = 0;
    for (const f of catFindings) {
      const base = SEVERITY_PENALTY[f.severity] || 0;
      const mult = CONFIDENCE_MULT[f.confidence] || 1;
      penalty += base * mult;
    }

    const score = Math.max(0, Math.round((cat.maxScore - penalty) * 10) / 10);
    const pct = score / cat.maxScore;
    let status: CategoryStatus = 'pass';
    if (pct < 0.5) status = 'fail';
    else if (pct < 0.75) status = 'warning';

    return {
      categoryId: cat.id,
      categoryName: cat.name,
      score: Math.min(score, cat.maxScore),
      maxScore: cat.maxScore,
      weight: cat.maxScore,
      status,
    };
  });
}

export function computeSmellIndex(smellHits: SmellHit[]): SmellIndex {
  // Deduplicate by id, summing counts
  const merged = new Map<string, SmellHit>();
  for (const hit of smellHits) {
    const existing = merged.get(hit.id);
    if (existing) {
      existing.count += hit.count;
    } else {
      merged.set(hit.id, { ...hit });
    }
  }

  const smells = Array.from(merged.values());

  // Score: number of distinct smell types (capped at 10)
  // Weight heavier smells more
  const SMELL_WEIGHTS: Record<string, number> = {
    'SMELL-MOCK-LEAKAGE': 2,
    'SMELL-FAKE-SUCCESS': 2,
    'SMELL-DISCONNECTED-BACKEND': 2,
    'SMELL-AUTH-IN-UI-ONLY': 2,
    'SMELL-FAKE-INTEGRATION-ADAPTER': 2,
  };

  let rawScore = 0;
  for (const smell of smells) {
    const weight = SMELL_WEIGHTS[smell.id] || 1;
    rawScore += Math.min(weight, smell.count);
  }
  const score = Math.min(10, rawScore);

  let level: SmellLevel = 'low';
  if (score >= 9) level = 'severe';
  else if (score >= 6) level = 'high';
  else if (score >= 3) level = 'moderate';

  return { score, maxScore: 10, level, smells };
}

export function computeGates(findings: Finding[]): Gate[] {
  const openFindings = findings.filter(f => f.status === 'open');

  const gateRules: Array<{ id: string; label: string; failRules: string[] }> = [
    { id: 'gate_no_fake_success', label: 'No false success states in core flows', failRules: ['FK-FR-STATE-001', 'FK-EH-FALSESUCCESS-001'] },
    { id: 'gate_no_dead_primary_actions', label: 'No dead primary actions', failRules: ['FK-FW-BTN-001', 'FK-FW-FORM-001'] },
    { id: 'gate_real_backend', label: 'Claimed actions must have real backend', failRules: ['FK-BE-ENDPOINT-001', 'FK-BE-PERSIST-001'] },
    { id: 'gate_server_side_auth', label: 'Server-side auth enforced', failRules: ['FK-SA-AUTH-001', 'FK-SA-AUTHZ-001'] },
    { id: 'gate_no_secrets', label: 'No secrets exposed', failRules: ['FK-SA-SECRET-001'] },
    { id: 'gate_tenant_isolation', label: 'Tenant isolation enforced', failRules: ['FK-DM-TENANT-001'] },
  ];

  return gateRules.map(gate => {
    const violations = openFindings.filter(f =>
      gate.failRules.includes(f.ruleId) && f.severity === 'critical'
    );
    return {
      id: gate.id,
      label: gate.label,
      status: violations.length > 0 ? 'fail' as const : 'pass' as const,
      reason: violations.length > 0 ? `${violations.length} critical violation(s)` : undefined,
    };
  });
}

export function computeSummary(
  scores: CategoryScore[],
  findings: Finding[],
  smellIndex: SmellIndex,
  gates: Gate[],
): AuditSummary {
  const totalScore = Math.min(100, Math.round(scores.reduce((sum, s) => sum + s.score, 0)));
  const openFindings = findings.filter(f => f.status === 'open');

  const criticalCount = openFindings.filter(f => f.severity === 'critical').length;
  const highCount = openFindings.filter(f => f.severity === 'high').length;
  const mediumCount = openFindings.filter(f => f.severity === 'medium').length;
  const lowCount = openFindings.filter(f => f.severity === 'low').length;

  let rating: Rating;
  if (totalScore >= 90) rating = 'production-ready';
  else if (totalScore >= 75) rating = 'strong-but-needs-targeted-fixes';
  else if (totalScore >= 60) rating = 'functional-but-risky';
  else if (totalScore >= 40) rating = 'misleading-fragile';
  else rating = 'cosmetic-not-trustworthy';

  const failedGates = gates.filter(g => g.status === 'fail');
  const hasAutoFail = criticalCount > 0 || failedGates.length > 0;
  const hasConditionalFail = highCount > 3 || totalScore < 75 || smellIndex.score > 8;

  let status: AuditStatus;
  if (hasAutoFail) status = 'fail';
  else if (hasConditionalFail) status = 'conditional-pass';
  else status = 'pass';

  const topRisks = openFindings
    .filter(f => f.severity === 'critical' || f.severity === 'high')
    .sort((a, b) => {
      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (sevOrder[a.severity] || 4) - (sevOrder[b.severity] || 4);
    })
    .slice(0, 5)
    .map(f => f.title);

  const launchBlockers = openFindings
    .filter(f => f.severity === 'critical')
    .map(f => f.title);

  let recommendation: string;
  if (status === 'pass') {
    recommendation = 'Project appears launch-ready. Address remaining medium/low findings for polish.';
  } else if (status === 'conditional-pass') {
    recommendation = `Address ${highCount} high-severity findings before launch. Score: ${totalScore}/100.`;
  } else {
    recommendation = `Do not launch. ${criticalCount} critical issue(s) and ${failedGates.length} failed gate(s) must be resolved.`;
  }

  const fingerprint = computeFingerprints(smellIndex.smells);

  return {
    totalScore,
    maxScore: 100,
    rating,
    status,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    topRisks,
    recommendation,
    launchBlockers,
    fingerprint,
  };
}
