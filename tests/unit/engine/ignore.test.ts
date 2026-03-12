import { describe, it, expect } from 'vitest';
import { applyIgnoreRules } from '../../../src/engine/ignore.js';
import type { Finding, IgnoreRule } from '../../../src/types/index.js';

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
    location: { file: 'src/app.ts' },
    ...overrides,
  };
}

describe('applyIgnoreRules', () => {
  it('returns all findings unchanged with no rules', () => {
    const findings = [makeFinding()];
    const { filtered, suppressedCount } = applyIgnoreRules(findings, []);
    expect(filtered).toEqual(findings);
    expect(suppressedCount).toBe(0);
  });

  it('suppresses finding by ruleId', () => {
    const findings = [makeFinding({ ruleId: 'FK-TEST-001' })];
    const rules: IgnoreRule[] = [{ type: 'ruleId', value: 'FK-TEST-001', raw: 'FK-TEST-001' }];
    const { filtered, suppressedCount } = applyIgnoreRules(findings, rules);
    expect(filtered[0].status).toBe('suppressed');
    expect(suppressedCount).toBe(1);
  });

  it('suppresses finding by findingId', () => {
    const findings = [makeFinding({ id: 'finding_001' })];
    const rules: IgnoreRule[] = [{ type: 'findingId', value: 'finding_001', raw: 'finding_001' }];
    const { filtered, suppressedCount } = applyIgnoreRules(findings, rules);
    expect(filtered[0].status).toBe('suppressed');
    expect(suppressedCount).toBe(1);
  });

  it('suppresses finding by fileGlob', () => {
    const findings = [makeFinding({ location: { file: 'src/api/route.ts' } })];
    const rules: IgnoreRule[] = [{ type: 'fileGlob', value: 'src/api/*', raw: 'src/api/*' }];
    const { filtered, suppressedCount } = applyIgnoreRules(findings, rules);
    expect(filtered[0].status).toBe('suppressed');
    expect(suppressedCount).toBe(1);
  });

  it('suppresses finding by ruleIdWithGlob', () => {
    const findings = [makeFinding({ ruleId: 'FK-TEST-001', location: { file: 'src/api/route.ts' } })];
    const rules: IgnoreRule[] = [{
      type: 'ruleIdWithGlob',
      value: 'FK-TEST-001',
      glob: 'src/api/*',
      raw: 'FK-TEST-001:src/api/*',
    }];
    const { filtered, suppressedCount } = applyIgnoreRules(findings, rules);
    expect(filtered[0].status).toBe('suppressed');
    expect(suppressedCount).toBe(1);
  });

  it('does not suppress when ruleIdWithGlob glob does not match', () => {
    const findings = [makeFinding({ ruleId: 'FK-TEST-001', location: { file: 'src/components/Page.tsx' } })];
    const rules: IgnoreRule[] = [{
      type: 'ruleIdWithGlob',
      value: 'FK-TEST-001',
      glob: 'src/api/*',
      raw: 'FK-TEST-001:src/api/*',
    }];
    const { filtered, suppressedCount } = applyIgnoreRules(findings, rules);
    expect(filtered[0].status).toBe('open');
    expect(suppressedCount).toBe(0);
  });

  it('does not suppress non-matching ruleId', () => {
    const findings = [makeFinding({ ruleId: 'FK-OTHER-001' })];
    const rules: IgnoreRule[] = [{ type: 'ruleId', value: 'FK-TEST-001', raw: 'FK-TEST-001' }];
    const { filtered, suppressedCount } = applyIgnoreRules(findings, rules);
    expect(filtered[0].status).toBe('open');
    expect(suppressedCount).toBe(0);
  });

  it('supports ** glob patterns', () => {
    const findings = [makeFinding({ location: { file: 'src/deep/nested/file.ts' } })];
    const rules: IgnoreRule[] = [{ type: 'fileGlob', value: 'src/**', raw: 'src/**' }];
    const { filtered, suppressedCount } = applyIgnoreRules(findings, rules);
    expect(filtered[0].status).toBe('suppressed');
    expect(suppressedCount).toBe(1);
  });

  it('suppresses multiple findings correctly', () => {
    const findings = [
      makeFinding({ id: 'f1', ruleId: 'FK-A-001' }),
      makeFinding({ id: 'f2', ruleId: 'FK-B-001' }),
      makeFinding({ id: 'f3', ruleId: 'FK-A-001' }),
    ];
    const rules: IgnoreRule[] = [{ type: 'ruleId', value: 'FK-A-001', raw: 'FK-A-001' }];
    const { filtered, suppressedCount } = applyIgnoreRules(findings, rules);
    expect(suppressedCount).toBe(2);
    expect(filtered[0].status).toBe('suppressed');
    expect(filtered[1].status).toBe('open');
    expect(filtered[2].status).toBe('suppressed');
  });
});
