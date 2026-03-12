import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeFeatureReality } from '../../../src/analyzers/feature-reality.js';
import { resetFindingCounter } from '../../../src/analyzers/base.js';
import { makeContext } from '../../helpers/make-context.js';

beforeEach(() => {
  resetFindingCounter();
});

describe('analyzeFeatureReality', () => {
  describe('FK-FR-MOCK-001: mock data in production paths', () => {
    it('detects mockData variable', () => {
      const ctx = makeContext({
        'src/components/Dashboard.tsx': `const data = mockData.users;`,
      });
      const result = analyzeFeatureReality(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FR-MOCK-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('critical');
    });

    it('detects fakeData', () => {
      const ctx = makeContext({
        'src/api/handler.ts': `const items = fakeData;`,
      });
      const result = analyzeFeatureReality(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FR-MOCK-001');
      expect(finding).toBeDefined();
    });

    it('detects placeholderItems', () => {
      const ctx = makeContext({
        'src/pages/Home.tsx': `const items = placeholderItems;`,
      });
      const result = analyzeFeatureReality(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FR-MOCK-001');
      expect(finding).toBeDefined();
    });

    it('skips test files', () => {
      const ctx = makeContext({
        'src/components/Dashboard.test.tsx': `const data = mockData.users;`,
      });
      const result = analyzeFeatureReality(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-FR-MOCK-001')).toHaveLength(0);
    });

    it('emits SMELL-MOCK-LEAKAGE when mock files found', () => {
      const ctx = makeContext({
        'src/utils/data.ts': `export const mockData = [1, 2, 3];`,
      });
      const result = analyzeFeatureReality(ctx);
      expect(result.smellHits.some(s => s.id === 'SMELL-MOCK-LEAKAGE')).toBe(true);
    });
  });

  describe('FK-FR-STATE-001: false success states', () => {
    it('detects success toast without prior await', () => {
      const ctx = makeContext({
        'src/components/Form.tsx': [
          'function handleSubmit() {',
          '  toast.success("Saved!");',
          '}',
        ].join('\n'),
      });
      const result = analyzeFeatureReality(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FR-STATE-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
    });

    it('passes when success toast follows await', () => {
      const ctx = makeContext({
        'src/components/Form.tsx': [
          'async function handleSubmit() {',
          '  await saveData();',
          '  toast.success("Saved!");',
          '}',
        ].join('\n'),
      });
      const result = analyzeFeatureReality(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-FR-STATE-001')).toHaveLength(0);
    });
  });

  describe('FK-FR-CLAIM-001: TODOs in critical paths', () => {
    it('detects TODO in API file', () => {
      const ctx = makeContext({
        'src/api/users.ts': `// TODO: implement real validation`,
      });
      const result = analyzeFeatureReality(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FR-CLAIM-001');
      expect(finding).toBeDefined();
    });

    it('detects FIXME in route handler', () => {
      const ctx = makeContext({
        'src/server/handler.ts': `// FIXME: this is broken`,
      });
      const result = analyzeFeatureReality(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FR-CLAIM-001');
      expect(finding).toBeDefined();
    });

    it('detects Python # TODO in service file', () => {
      const ctx = makeContext({
        'src/service/auth.py': `# TODO: add rate limiting`,
      });
      const result = analyzeFeatureReality(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FR-CLAIM-001');
      expect(finding).toBeDefined();
    });

    it('ignores TODOs in non-critical paths', () => {
      const ctx = makeContext({
        'src/components/Footer.tsx': `// TODO: add copyright year`,
      });
      const result = analyzeFeatureReality(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-FR-CLAIM-001')).toHaveLength(0);
    });
  });

  describe('hardcoded demo values', () => {
    it('detects Lorem ipsum', () => {
      const ctx = makeContext({
        'src/components/Hero.ts': 'const name = "John Doe";',
      });
      const result = analyzeFeatureReality(ctx);
      const finding = result.findings.find(f => f.title.includes('demo/placeholder'));
      expect(finding).toBeDefined();
    });

    it('detects test@test.com', () => {
      const ctx = makeContext({
        'src/config.ts': `const email = "test@test.com";`,
      });
      const result = analyzeFeatureReality(ctx);
      const finding = result.findings.find(f => f.title.includes('demo/placeholder'));
      expect(finding).toBeDefined();
    });
  });

  describe('clean code', () => {
    it('returns no findings for production-quality code', () => {
      const ctx = makeContext({
        'src/components/Page.tsx': [
          'import { useEffect, useState } from "react";',
          'export function Page() {',
          '  const [data, setData] = useState([]);',
          '  return <div>{data.length}</div>;',
          '}',
        ].join('\n'),
      });
      const result = analyzeFeatureReality(ctx);
      expect(result.findings).toHaveLength(0);
    });
  });
});
