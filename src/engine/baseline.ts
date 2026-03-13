// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
import type { AuditReport, Finding, Severity, CategoryScore } from '../types/index.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// ─── Types ──────────────────────────────────────────────────────────

export interface BaseFinding {
  ruleId: string;
  file: string;
  line?: number;
  title: string;
  severity: Severity;
}

export interface BaselineCategoryScore {
  score: number;
  max: number;
}

export interface Baseline {
  version: string;
  savedAt: string;
  score: number;
  rating: string;
  findingCount: number;
  findings: BaseFinding[];
  categoryScores: Record<string, BaselineCategoryScore>;
}

export interface BaselineDiff {
  scoreDelta: number;
  previousScore: number;
  currentScore: number;
  newFindings: Finding[];
  fixedFindings: BaseFinding[];
  regressions: Finding[];
  summary: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

function stripFinding(f: Finding): BaseFinding {
  return {
    ruleId: f.ruleId,
    file: f.location.file,
    line: f.location.startLine,
    title: f.title,
    severity: f.severity,
  };
}

function findingKey(ruleId: string, file: string): string {
  return `${ruleId}::${file}`;
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function isWorseSeverity(current: Severity, previous: Severity): boolean {
  return (SEVERITY_ORDER[current] ?? 4) < (SEVERITY_ORDER[previous] ?? 4);
}

// ─── Core Functions ─────────────────────────────────────────────────

export function saveBaseline(report: AuditReport, outPath: string): void {
  const categoryScores: Record<string, BaselineCategoryScore> = {};
  for (const cat of report.scores) {
    categoryScores[cat.categoryId] = {
      score: cat.score,
      max: cat.maxScore,
    };
  }

  const baseline: Baseline = {
    version: '1.0.0',
    savedAt: new Date().toISOString(),
    score: report.summary.totalScore,
    rating: report.summary.rating,
    findingCount: report.findings.filter(f => f.status === 'open').length,
    findings: report.findings.filter(f => f.status === 'open').map(stripFinding),
    categoryScores,
  };

  writeFileSync(outPath, JSON.stringify(baseline, null, 2));
}

export function loadBaseline(path: string): Baseline | null {
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as Baseline;

    // Basic validation: must have version, score, and findings array
    if (
      typeof data.version !== 'string' ||
      typeof data.score !== 'number' ||
      !Array.isArray(data.findings)
    ) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

export function diffBaseline(current: AuditReport, baseline: Baseline): BaselineDiff {
  const currentFindings = current.findings.filter(f => f.status === 'open');
  const currentScore = current.summary.totalScore;
  const previousScore = baseline.score;
  const scoreDelta = currentScore - previousScore;

  // Build lookup maps keyed by ruleId::file
  const baselineMap = new Map<string, BaseFinding>();
  for (const f of baseline.findings) {
    baselineMap.set(findingKey(f.ruleId, f.file), f);
  }

  const currentMap = new Map<string, Finding>();
  for (const f of currentFindings) {
    currentMap.set(findingKey(f.ruleId, f.location.file), f);
  }

  // New findings: in current but not in baseline
  const newFindings: Finding[] = [];
  for (const f of currentFindings) {
    const key = findingKey(f.ruleId, f.location.file);
    if (!baselineMap.has(key)) {
      newFindings.push(f);
    }
  }

  // Fixed findings: in baseline but not in current
  const fixedFindings: BaseFinding[] = [];
  for (const f of baseline.findings) {
    const key = findingKey(f.ruleId, f.file);
    if (!currentMap.has(key)) {
      fixedFindings.push(f);
    }
  }

  // Regressions: same ruleId+file but severity got worse
  const regressions: Finding[] = [];
  for (const f of currentFindings) {
    const key = findingKey(f.ruleId, f.location.file);
    const prev = baselineMap.get(key);
    if (prev && isWorseSeverity(f.severity, prev.severity)) {
      regressions.push(f);
    }
  }

  // Summary one-liner
  const arrow = scoreDelta > 0 ? '+' : scoreDelta < 0 ? '' : '±';
  const parts: string[] = [
    `Score: ${previousScore} → ${currentScore} (${arrow}${scoreDelta}).`,
  ];
  if (fixedFindings.length > 0) parts.push(`${fixedFindings.length} fixed`);
  if (newFindings.length > 0) parts.push(`${newFindings.length} new`);
  if (regressions.length > 0) parts.push(`${regressions.length} regressed`);
  const summary = parts.length > 1
    ? `${parts[0]} ${parts.slice(1).join(', ')}.`
    : `${parts[0]} No changes.`;

  return {
    scoreDelta,
    previousScore,
    currentScore,
    newFindings,
    fixedFindings,
    regressions,
    summary,
  };
}
