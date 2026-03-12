import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeMaintainability } from '../../../src/analyzers/maintainability.js';
import { resetFindingCounter } from '../../../src/analyzers/base.js';
import { makeContext } from '../../helpers/make-context.js';

beforeEach(() => {
  resetFindingCounter();
});

describe('analyzeMaintainability', () => {
  describe('FK-MH-SIZE-001: giant files', () => {
    it('detects file over 500 lines as medium severity', () => {
      const lines = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};`);
      const ctx = makeContext({
        'src/big-file.ts': lines.join('\n'),
      });
      const result = analyzeMaintainability(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-MH-SIZE-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('medium');
      expect(finding!.title).toContain('600');
    });

    it('detects file over 1000 lines as high severity', () => {
      const lines = Array.from({ length: 1100 }, (_, i) => `const x${i} = ${i};`);
      const ctx = makeContext({
        'src/huge-file.ts': lines.join('\n'),
      });
      const result = analyzeMaintainability(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-MH-SIZE-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
    });

    it('passes for files under 500 lines', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `const x${i} = ${i};`);
      const ctx = makeContext({
        'src/small-file.ts': lines.join('\n'),
      });
      const result = analyzeMaintainability(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-MH-SIZE-001')).toHaveLength(0);
    });

    it('ignores test files', () => {
      const lines = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};`);
      const ctx = makeContext({
        'src/app.test.ts': lines.join('\n'),
      });
      const result = analyzeMaintainability(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-MH-SIZE-001')).toHaveLength(0);
    });
  });

  describe('FK-MH-DEADCODE-001: commented-out code', () => {
    it('detects excessive commented-out code (>10 lines)', () => {
      const lines = Array.from({ length: 15 }, (_, i) => `// const x${i} = ${i};`);
      const ctx = makeContext({
        'src/app.ts': lines.join('\n'),
      });
      const result = analyzeMaintainability(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-MH-DEADCODE-001');
      expect(finding).toBeDefined();
      expect(result.smellHits.some(s => s.id === 'SMELL-COMMENTED-REAL-LOGIC')).toBe(true);
    });

    it('passes for <= 10 lines of commented code', () => {
      const lines = Array.from({ length: 5 }, (_, i) => `// const x${i} = ${i};`);
      const ctx = makeContext({
        'src/app.ts': lines.join('\n'),
      });
      const result = analyzeMaintainability(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-MH-DEADCODE-001')).toHaveLength(0);
    });
  });

  describe('FK-MH-DUPLICATION-001: possible duplicated logic', () => {
    it('detects near-duplicate function names', () => {
      const ctx = makeContext({
        'src/utils.ts': [
          'export function processUser() {}',
          'export function processuser1() {}',
          'export function processuser2() {}',
        ].join('\n'),
      });
      const result = analyzeMaintainability(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-MH-DUPLICATION-001');
      expect(finding).toBeDefined();
    });
  });
});
