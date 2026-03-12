import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { diffBaseline, loadBaseline, saveBaseline } from '../../../src/engine/baseline.js';
import type { AuditReport, Finding, Baseline } from '../../../src/types/index.js';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    version: '1.0.0',
    savedAt: new Date().toISOString(),
    score: 80,
    rating: 'strong-but-needs-targeted-fixes',
    findingCount: 1,
    findings: [
      {
        ruleId: 'FK-TEST-001',
        file: 'test.ts',
        line: 10,
        title: 'Test finding',
        severity: 'medium',
      },
    ],
    categoryScores: {},
    ...overrides,
  };
}

function makeReport(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    schemaVersion: '1.0.0',
    reportId: 'test-report',
    generatedAt: new Date().toISOString(),
    project: { name: 'test', path: '/test' },
    audit: { type: 'launch-readiness', mode: 'static', durationMs: 100 },
    summary: {
      totalScore: 80,
      maxScore: 100,
      rating: 'strong-but-needs-targeted-fixes',
      status: 'pass',
      criticalCount: 0,
      highCount: 0,
      mediumCount: 1,
      lowCount: 0,
      topRisks: [],
      recommendation: '',
      launchBlockers: [],
    },
    scores: [],
    smellIndex: { score: 0, maxScore: 10, level: 'low', smells: [] },
    findings: [makeFinding()],
    gates: [],
    ...overrides,
  };
}

describe('diffBaseline', () => {
  it('detects new findings not in baseline', () => {
    const baseline = makeBaseline({
      score: 80,
      findings: [
        { ruleId: 'FK-OLD-001', file: 'old.ts', title: 'Old issue', severity: 'medium' },
      ],
    });
    const report = makeReport({
      summary: { ...makeReport().summary, totalScore: 75 },
      findings: [
        makeFinding({ ruleId: 'FK-OLD-001', location: { file: 'old.ts' } }),
        makeFinding({ id: 'f2', ruleId: 'FK-NEW-001', title: 'New issue', location: { file: 'new.ts' } }),
      ],
    });

    const diff = diffBaseline(report, baseline);
    expect(diff.newFindings).toHaveLength(1);
    expect(diff.newFindings[0].ruleId).toBe('FK-NEW-001');
  });

  it('detects fixed findings removed from current', () => {
    const baseline = makeBaseline({
      score: 70,
      findings: [
        { ruleId: 'FK-FIXED-001', file: 'fixed.ts', title: 'Fixed issue', severity: 'high' },
        { ruleId: 'FK-KEEP-001', file: 'keep.ts', title: 'Keep issue', severity: 'medium' },
      ],
    });
    const report = makeReport({
      summary: { ...makeReport().summary, totalScore: 85 },
      findings: [
        makeFinding({ ruleId: 'FK-KEEP-001', location: { file: 'keep.ts' } }),
      ],
    });

    const diff = diffBaseline(report, baseline);
    expect(diff.fixedFindings).toHaveLength(1);
    expect(diff.fixedFindings[0].ruleId).toBe('FK-FIXED-001');
  });

  it('computes score changes correctly', () => {
    const baseline = makeBaseline({ score: 60 });
    const report = makeReport({
      summary: { ...makeReport().summary, totalScore: 75 },
      findings: [makeFinding()],
    });

    const diff = diffBaseline(report, baseline);
    expect(diff.previousScore).toBe(60);
    expect(diff.currentScore).toBe(75);
    expect(diff.scoreDelta).toBe(15);
    expect(diff.summary).toContain('60');
    expect(diff.summary).toContain('75');
  });

  it('detects regressions when severity worsens', () => {
    const baseline = makeBaseline({
      findings: [
        { ruleId: 'FK-REG-001', file: 'reg.ts', title: 'Regressed', severity: 'medium' },
      ],
    });
    const report = makeReport({
      findings: [
        makeFinding({ ruleId: 'FK-REG-001', severity: 'critical', location: { file: 'reg.ts' } }),
      ],
    });

    const diff = diffBaseline(report, baseline);
    expect(diff.regressions).toHaveLength(1);
    expect(diff.regressions[0].ruleId).toBe('FK-REG-001');
  });

  it('reports no changes when baseline matches current', () => {
    const baseline = makeBaseline({
      score: 80,
      findings: [
        { ruleId: 'FK-TEST-001', file: 'test.ts', title: 'Test', severity: 'medium' },
      ],
    });
    const report = makeReport({
      summary: { ...makeReport().summary, totalScore: 80 },
      findings: [
        makeFinding({ ruleId: 'FK-TEST-001', location: { file: 'test.ts' } }),
      ],
    });

    const diff = diffBaseline(report, baseline);
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.fixedFindings).toHaveLength(0);
    expect(diff.regressions).toHaveLength(0);
    expect(diff.scoreDelta).toBe(0);
    expect(diff.summary).toContain('No changes');
  });
});

describe('loadBaseline', () => {
  it('returns null for non-existent file', () => {
    const result = loadBaseline('/tmp/does-not-exist-flaw-baseline.json');
    expect(result).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const tmpPath = join(tmpdir(), `flaw-test-bad-${Date.now()}.json`);
    const { writeFileSync } = require('node:fs');
    writeFileSync(tmpPath, '{ invalid json }}}', 'utf-8');
    try {
      const result = loadBaseline(tmpPath);
      expect(result).toBeNull();
    } finally {
      unlinkSync(tmpPath);
    }
  });
});

describe('saveBaseline', () => {
  it('writes valid JSON to the specified path', () => {
    const tmpPath = join(tmpdir(), `flaw-test-save-${Date.now()}.json`);
    const report = makeReport();

    try {
      saveBaseline(report, tmpPath);
      expect(existsSync(tmpPath)).toBe(true);

      const raw = readFileSync(tmpPath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.version).toBe('1.0.0');
      expect(typeof parsed.score).toBe('number');
      expect(Array.isArray(parsed.findings)).toBe(true);
      expect(parsed.score).toBe(80);
    } finally {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    }
  });
});
