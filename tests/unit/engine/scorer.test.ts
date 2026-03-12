import { describe, it, expect } from 'vitest';
import { computeCategoryScores, computeSmellIndex, computeGates, computeSummary } from '../../../src/engine/scorer.js';
import type { Finding, SmellHit, CategoryScore, SmellIndex, Gate } from '../../../src/types/index.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'finding_001',
    title: 'Test finding',
    ruleId: 'FK-TEST-001',
    categoryId: 'FR',
    severity: 'medium',
    confidence: 'high',
    status: 'open',
    labels: [],
    summary: 'test',
    impact: 'test',
    location: { file: 'test.ts' },
    ...overrides,
  };
}

describe('computeCategoryScores', () => {
  it('returns max score for all categories with no findings', () => {
    const scores = computeCategoryScores([]);
    expect(scores).toHaveLength(10);
    const frScore = scores.find(s => s.categoryId === 'FR')!;
    expect(frScore.score).toBe(15);
    expect(frScore.maxScore).toBe(15);
    expect(frScore.status).toBe('pass');
  });

  it('deducts penalty for open findings based on severity and confidence', () => {
    // critical (12) * high confidence (1.0) = 12 penalty
    const findings: Finding[] = [
      makeFinding({ categoryId: 'FR', severity: 'critical', confidence: 'high' }),
    ];
    const scores = computeCategoryScores(findings);
    const frScore = scores.find(s => s.categoryId === 'FR')!;
    expect(frScore.score).toBe(3); // 15 - 12 = 3
  });

  it('applies confidence multiplier to penalty', () => {
    // high severity (7) * medium confidence (0.75) = 5.25
    const findings: Finding[] = [
      makeFinding({ categoryId: 'FR', severity: 'high', confidence: 'medium' }),
    ];
    const scores = computeCategoryScores(findings);
    const frScore = scores.find(s => s.categoryId === 'FR')!;
    // 15 - 5.25 = 9.75, rounded to 9.8
    expect(frScore.score).toBe(9.8);
  });

  it('clamps score to 0 minimum', () => {
    const findings: Finding[] = [
      makeFinding({ categoryId: 'EH', severity: 'critical', confidence: 'high' }),
      makeFinding({ id: 'f2', categoryId: 'EH', severity: 'critical', confidence: 'high' }),
    ];
    const scores = computeCategoryScores(findings);
    const ehScore = scores.find(s => s.categoryId === 'EH')!;
    // EH maxScore=8, penalty=24, clamped to 0
    expect(ehScore.score).toBe(0);
  });

  it('ignores suppressed findings', () => {
    const findings: Finding[] = [
      makeFinding({ categoryId: 'FR', severity: 'critical', status: 'suppressed' }),
    ];
    const scores = computeCategoryScores(findings);
    const frScore = scores.find(s => s.categoryId === 'FR')!;
    expect(frScore.score).toBe(15);
  });

  it('sets status to fail when score < 50%', () => {
    // FR maxScore=15, need penalty > 7.5 => 15 - penalty < 7.5
    const findings: Finding[] = [
      makeFinding({ categoryId: 'FR', severity: 'critical', confidence: 'high' }),
    ];
    const scores = computeCategoryScores(findings);
    const frScore = scores.find(s => s.categoryId === 'FR')!;
    // score = 3, 3/15 = 0.2 < 0.5
    expect(frScore.status).toBe('fail');
  });

  it('sets status to warning when 50% <= score < 75%', () => {
    // FR maxScore=15, need score between 7.5 and 11.25
    // high severity (7) * high confidence (1.0) = 7 => score = 8
    const findings: Finding[] = [
      makeFinding({ categoryId: 'FR', severity: 'high', confidence: 'high' }),
    ];
    const scores = computeCategoryScores(findings);
    const frScore = scores.find(s => s.categoryId === 'FR')!;
    // 15 - 7 = 8, 8/15 = 0.533 => warning
    expect(frScore.status).toBe('warning');
  });
});

describe('computeSmellIndex', () => {
  it('returns 0 for no smells', () => {
    const result = computeSmellIndex([]);
    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
    expect(result.maxScore).toBe(10);
  });

  it('deduplicates smell hits by id, summing counts', () => {
    const hits: SmellHit[] = [
      { id: 'SMELL-A', label: 'A', count: 2 },
      { id: 'SMELL-A', label: 'A', count: 3 },
    ];
    const result = computeSmellIndex(hits);
    expect(result.smells).toHaveLength(1);
    expect(result.smells[0].count).toBe(5);
  });

  it('uses weight=2 for known heavy smells', () => {
    const hits: SmellHit[] = [
      { id: 'SMELL-MOCK-LEAKAGE', label: 'Mock leakage', count: 5 },
    ];
    const result = computeSmellIndex(hits);
    // weight 2, min(2, 5) = 2
    expect(result.score).toBe(2);
  });

  it('uses weight=1 for unknown smells', () => {
    const hits: SmellHit[] = [
      { id: 'SMELL-CUSTOM', label: 'Custom', count: 5 },
    ];
    const result = computeSmellIndex(hits);
    // weight 1, min(1, 5) = 1
    expect(result.score).toBe(1);
  });

  it('caps score at 10', () => {
    const hits: SmellHit[] = Array.from({ length: 15 }, (_, i) => ({
      id: `SMELL-${i}`,
      label: `Smell ${i}`,
      count: 3,
    }));
    const result = computeSmellIndex(hits);
    expect(result.score).toBe(10);
  });

  it('sets level based on score thresholds', () => {
    // score=0 => low, score=3 => moderate, score=6 => high, score=9 => severe
    expect(computeSmellIndex([]).level).toBe('low');

    const mod: SmellHit[] = [
      { id: 'A', label: 'a', count: 1 },
      { id: 'B', label: 'b', count: 1 },
      { id: 'C', label: 'c', count: 1 },
    ];
    expect(computeSmellIndex(mod).level).toBe('moderate');

    const high: SmellHit[] = Array.from({ length: 6 }, (_, i) => ({
      id: `S${i}`, label: `s${i}`, count: 1,
    }));
    expect(computeSmellIndex(high).level).toBe('high');

    const severe: SmellHit[] = Array.from({ length: 9 }, (_, i) => ({
      id: `S${i}`, label: `s${i}`, count: 1,
    }));
    expect(computeSmellIndex(severe).level).toBe('severe');
  });
});

describe('computeGates', () => {
  it('all gates pass with no findings', () => {
    const gates = computeGates([]);
    expect(gates).toHaveLength(6);
    expect(gates.every(g => g.status === 'pass')).toBe(true);
  });

  it('gate fails when matching critical finding exists', () => {
    const findings: Finding[] = [
      makeFinding({ ruleId: 'FK-SA-SECRET-001', severity: 'critical', status: 'open' }),
    ];
    const gates = computeGates(findings);
    const secretGate = gates.find(g => g.id === 'gate_no_secrets')!;
    expect(secretGate.status).toBe('fail');
    expect(secretGate.reason).toContain('1 critical violation');
  });

  it('gate passes when finding is not critical severity', () => {
    const findings: Finding[] = [
      makeFinding({ ruleId: 'FK-SA-SECRET-001', severity: 'high', status: 'open' }),
    ];
    const gates = computeGates(findings);
    const secretGate = gates.find(g => g.id === 'gate_no_secrets')!;
    expect(secretGate.status).toBe('pass');
  });

  it('gate passes when finding is suppressed', () => {
    const findings: Finding[] = [
      makeFinding({ ruleId: 'FK-SA-SECRET-001', severity: 'critical', status: 'suppressed' }),
    ];
    const gates = computeGates(findings);
    const secretGate = gates.find(g => g.id === 'gate_no_secrets')!;
    expect(secretGate.status).toBe('pass');
  });
});

describe('computeSummary', () => {
  function makeScores(total: number): CategoryScore[] {
    // Distribute total across 10 categories proportionally
    return [
      { categoryId: 'FR', categoryName: 'FR', score: total * 0.15, maxScore: 15, weight: 15, status: 'pass' },
      { categoryId: 'FW', categoryName: 'FW', score: total * 0.12, maxScore: 12, weight: 12, status: 'pass' },
      { categoryId: 'BE', categoryName: 'BE', score: total * 0.12, maxScore: 12, weight: 12, status: 'pass' },
      { categoryId: 'DM', categoryName: 'DM', score: total * 0.10, maxScore: 10, weight: 10, status: 'pass' },
      { categoryId: 'VB', categoryName: 'VB', score: total * 0.08, maxScore: 8, weight: 8, status: 'pass' },
      { categoryId: 'EH', categoryName: 'EH', score: total * 0.08, maxScore: 8, weight: 8, status: 'pass' },
      { categoryId: 'SA', categoryName: 'SA', score: total * 0.12, maxScore: 12, weight: 12, status: 'pass' },
      { categoryId: 'MH', categoryName: 'MH', score: total * 0.08, maxScore: 8, weight: 8, status: 'pass' },
      { categoryId: 'TV', categoryName: 'TV', score: total * 0.08, maxScore: 8, weight: 8, status: 'pass' },
      { categoryId: 'DO', categoryName: 'DO', score: total * 0.07, maxScore: 7, weight: 7, status: 'pass' },
    ];
  }

  it('returns production-ready for score >= 90', () => {
    const scores = makeScores(95);
    const smellIndex: SmellIndex = { score: 0, maxScore: 10, level: 'low', smells: [] };
    const gates: Gate[] = [{ id: 'g1', label: 'g1', status: 'pass' }];
    const summary = computeSummary(scores, [], smellIndex, gates);
    expect(summary.rating).toBe('production-ready');
    expect(summary.status).toBe('pass');
  });

  it('returns fail when critical findings exist', () => {
    const scores = makeScores(95);
    const findings: Finding[] = [makeFinding({ severity: 'critical', status: 'open' })];
    const smellIndex: SmellIndex = { score: 0, maxScore: 10, level: 'low', smells: [] };
    const gates: Gate[] = [{ id: 'g1', label: 'g1', status: 'pass' }];
    const summary = computeSummary(scores, findings, smellIndex, gates);
    expect(summary.status).toBe('fail');
    expect(summary.criticalCount).toBe(1);
  });

  it('returns fail when gates fail', () => {
    const scores = makeScores(95);
    const smellIndex: SmellIndex = { score: 0, maxScore: 10, level: 'low', smells: [] };
    const gates: Gate[] = [{ id: 'g1', label: 'g1', status: 'fail', reason: 'test' }];
    const summary = computeSummary(scores, [], smellIndex, gates);
    expect(summary.status).toBe('fail');
  });

  it('returns conditional-pass when high count > 3', () => {
    const scores = makeScores(80);
    const findings: Finding[] = [
      makeFinding({ severity: 'high', status: 'open' }),
      makeFinding({ id: 'f2', severity: 'high', status: 'open' }),
      makeFinding({ id: 'f3', severity: 'high', status: 'open' }),
      makeFinding({ id: 'f4', severity: 'high', status: 'open' }),
    ];
    const smellIndex: SmellIndex = { score: 0, maxScore: 10, level: 'low', smells: [] };
    const gates: Gate[] = [{ id: 'g1', label: 'g1', status: 'pass' }];
    const summary = computeSummary(scores, findings, smellIndex, gates);
    expect(summary.status).toBe('conditional-pass');
    expect(summary.highCount).toBe(4);
  });

  it('returns conditional-pass when smell index > 8', () => {
    const scores = makeScores(80);
    const smellIndex: SmellIndex = { score: 9, maxScore: 10, level: 'severe', smells: [] };
    const gates: Gate[] = [{ id: 'g1', label: 'g1', status: 'pass' }];
    const summary = computeSummary(scores, [], smellIndex, gates);
    expect(summary.status).toBe('conditional-pass');
  });

  it('rating thresholds: strong, functional, misleading, cosmetic', () => {
    const smellIndex: SmellIndex = { score: 0, maxScore: 10, level: 'low', smells: [] };
    const gates: Gate[] = [];

    expect(computeSummary(makeScores(80), [], smellIndex, gates).rating).toBe('strong-but-needs-targeted-fixes');
    expect(computeSummary(makeScores(65), [], smellIndex, gates).rating).toBe('functional-but-risky');
    expect(computeSummary(makeScores(45), [], smellIndex, gates).rating).toBe('misleading-fragile');
    expect(computeSummary(makeScores(30), [], smellIndex, gates).rating).toBe('cosmetic-not-trustworthy');
  });

  it('topRisks lists critical and high severity findings', () => {
    const scores = makeScores(50);
    const findings: Finding[] = [
      makeFinding({ id: 'f1', title: 'Critical Bug', severity: 'critical', status: 'open' }),
      makeFinding({ id: 'f2', title: 'High Bug', severity: 'high', status: 'open' }),
      makeFinding({ id: 'f3', title: 'Low Bug', severity: 'low', status: 'open' }),
    ];
    const smellIndex: SmellIndex = { score: 0, maxScore: 10, level: 'low', smells: [] };
    const gates: Gate[] = [];
    const summary = computeSummary(scores, findings, smellIndex, gates);
    expect(summary.topRisks).toContain('Critical Bug');
    expect(summary.topRisks).toContain('High Bug');
    expect(summary.topRisks).not.toContain('Low Bug');
  });

  it('launchBlockers includes only critical findings', () => {
    const scores = makeScores(50);
    const findings: Finding[] = [
      makeFinding({ id: 'f1', title: 'Critical Bug', severity: 'critical', status: 'open' }),
      makeFinding({ id: 'f2', title: 'High Bug', severity: 'high', status: 'open' }),
    ];
    const smellIndex: SmellIndex = { score: 0, maxScore: 10, level: 'low', smells: [] };
    const gates: Gate[] = [];
    const summary = computeSummary(scores, findings, smellIndex, gates);
    expect(summary.launchBlockers).toEqual(['Critical Bug']);
  });
});
