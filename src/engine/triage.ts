// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
// Priority triage — "Fix these 3 things first"
import type { Finding, CategoryScore, TriageGroup, TriageResult } from '../types/index.js';

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 100,
  high: 60,
  medium: 25,
  low: 5,
  info: 0,
};

const CONFIDENCE_MULT: Record<string, number> = {
  high: 1.0,
  medium: 0.75,
  low: 0.5,
};

const LABEL_BONUS: Record<string, number> = {
  'Production-Blocking': 50,
  'Broken': 30,
  'Auth Gap': 25,
  'Fake Flow': 20,
  'Silent Failure': 15,
  'Dead Control': 10,
};

// Gate-related rule IDs get extra weight
const GATE_RULES = new Set([
  'FK-FR-STATE-001', 'FK-EH-FALSESUCCESS-001',
  'FK-FW-BTN-001', 'FK-FW-FORM-001',
  'FK-BE-ENDPOINT-001', 'FK-BE-PERSIST-001',
  'FK-SA-AUTH-001', 'FK-SA-AUTHZ-001',
  'FK-SA-SECRET-001', 'FK-DM-TENANT-001',
]);

function blastScore(f: Finding, failedCategories: Set<string>): number {
  let score = SEVERITY_WEIGHT[f.severity] || 0;
  score *= CONFIDENCE_MULT[f.confidence] || 1;

  for (const label of f.labels) {
    score += LABEL_BONUS[label] || 0;
  }

  if (GATE_RULES.has(f.ruleId)) score += 40;
  if (failedCategories.has(f.categoryId)) score += 20;

  return score;
}

export function computeTriage(findings: Finding[], scores: CategoryScore[]): TriageResult {
  const openFindings = findings.filter(f => f.status === 'open');
  const failedCategories = new Set(scores.filter(s => s.status === 'fail').map(s => s.categoryId));

  // Score and sort all findings by blast radius
  const scored = openFindings.map(f => ({
    finding: f,
    score: blastScore(f, failedCategories),
  })).sort((a, b) => b.score - a.score);

  // Deduplicate: if multiple findings have same ruleId+file, keep highest scored
  const seen = new Set<string>();
  const deduped = scored.filter(s => {
    const key = `${s.finding.ruleId}:${s.finding.location.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Bucket into 3 priority groups
  const p1: Finding[] = [];
  const p2: Finding[] = [];
  const p3: Finding[] = [];

  for (const { finding, score } of deduped) {
    if (score >= 80 || finding.severity === 'critical') {
      p1.push(finding);
    } else if (score >= 30 || finding.severity === 'high') {
      p2.push(finding);
    } else {
      p3.push(finding);
    }
  }

  const groups: TriageGroup[] = [];

  if (p1.length > 0) {
    groups.push({
      priority: 1,
      label: 'Fix immediately — these break things',
      findings: p1.slice(0, 5),
      blastRadius: 'critical',
      rationale: 'Gate failures, runtime crashes, or security holes.',
    });
  }

  if (p2.length > 0) {
    groups.push({
      priority: 2,
      label: 'Fix before launch',
      findings: p2,
      blastRadius: 'high',
      rationale: 'High-severity issues that degrade reliability or user trust.',
    });
  }

  if (p3.length > 0) {
    groups.push({
      priority: 3,
      label: 'Polish when you can',
      findings: p3,
      blastRadius: 'moderate',
      rationale: 'Code quality and maintainability improvements.',
    });
  }

  const topThree = deduped.slice(0, 3).map(s => s.finding);

  return { groups, topThree };
}
