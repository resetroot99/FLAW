import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeCrossWiring } from '../../../src/analyzers/cross-wiring.js';
import { resetFindingCounter } from '../../../src/analyzers/base.js';
import { makeContext } from '../../helpers/make-context.js';

beforeEach(() => {
  resetFindingCounter();
});

describe('analyzeCrossWiring', () => {
  describe('FK-CW-IMPORT-001: detects import of non-existent file', () => {
    it('flags import referencing a missing module', () => {
      const ctx = makeContext({
        'src/app.ts': `import { helper } from './utils/helper';`,
      });
      const result = analyzeCrossWiring(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-CW-IMPORT-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
    });

    it('passes when imported file exists in context', () => {
      const ctx = makeContext({
        'src/app.ts': `import { helper } from './utils/helper';`,
        'src/utils/helper.ts': `export function helper() { return 1; }`,
      });
      const result = analyzeCrossWiring(ctx);
      const importFindings = result.findings.filter(f => f.ruleId === 'FK-CW-IMPORT-001');
      expect(importFindings).toHaveLength(0);
    });

    it('resolves .js extension to .ts file on disk', () => {
      const ctx = makeContext({
        'src/app.ts': `import { helper } from './utils/helper.js';`,
        'src/utils/helper.ts': `export function helper() { return 1; }`,
      });
      const result = analyzeCrossWiring(ctx);
      const importFindings = result.findings.filter(f => f.ruleId === 'FK-CW-IMPORT-001');
      expect(importFindings).toHaveLength(0);
    });

    it('resolves index file imports', () => {
      const ctx = makeContext({
        'src/app.ts': `import { helper } from './utils';`,
        'src/utils/index.ts': `export function helper() { return 1; }`,
      });
      const result = analyzeCrossWiring(ctx);
      const importFindings = result.findings.filter(f => f.ruleId === 'FK-CW-IMPORT-001');
      expect(importFindings).toHaveLength(0);
    });

    it('flags require() of non-existent module', () => {
      const ctx = makeContext({
        'src/app.ts': `const lib = require('./lib/missing');`,
      });
      const result = analyzeCrossWiring(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-CW-IMPORT-001');
      expect(finding).toBeDefined();
    });

    it('flags aliased import when alias resolves to non-existent file', () => {
      const ctx = makeContext({
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            paths: { '@/*': ['src/*'] },
          },
        }),
        'src/app.ts': `import { thing } from '@/lib/missing';`,
      });
      const result = analyzeCrossWiring(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-CW-IMPORT-001');
      expect(finding).toBeDefined();
    });
  });

  describe('FK-CW-HANDLER-001: event handler verification', () => {
    it('passes when handler is defined in file as const', () => {
      const ctx = makeContext({
        'src/components/Button.tsx': [
          'function MyButton() {',
          '  const handleSubmit = () => { console.log("submit"); };',
          '  return <button onClick={handleSubmit}>Click</button>;',
          '}',
        ].join('\n'),
      });
      const result = analyzeCrossWiring(ctx);
      const handlerFindings = result.findings.filter(f => f.ruleId === 'FK-CW-HANDLER-001');
      expect(handlerFindings).toHaveLength(0);
    });

    it('passes when handler is imported', () => {
      const ctx = makeContext({
        'src/components/Button.tsx': [
          'import { handleSubmit } from "../actions";',
          'function MyButton() {',
          '  return <button onClick={handleSubmit}>Click</button>;',
          '}',
        ].join('\n'),
      });
      const result = analyzeCrossWiring(ctx);
      const handlerFindings = result.findings.filter(f => f.ruleId === 'FK-CW-HANDLER-001');
      expect(handlerFindings).toHaveLength(0);
    });

    it('passes when handler is passed as a destructured prop', () => {
      const ctx = makeContext({
        'src/components/Button.tsx': [
          'function MyButton({ onPress }) {',
          '  return <button onClick={onPress}>Click</button>;',
          '}',
        ].join('\n'),
      });
      const result = analyzeCrossWiring(ctx);
      const handlerFindings = result.findings.filter(f => f.ruleId === 'FK-CW-HANDLER-001');
      expect(handlerFindings).toHaveLength(0);
    });

    it('passes when handler is a default import', () => {
      const ctx = makeContext({
        'src/components/Button.tsx': [
          'import submitHandler from "../actions";',
          'function MyButton() {',
          '  return <button onClick={submitHandler}>Click</button>;',
          '}',
        ].join('\n'),
      });
      const result = analyzeCrossWiring(ctx);
      const handlerFindings = result.findings.filter(f => f.ruleId === 'FK-CW-HANDLER-001');
      expect(handlerFindings).toHaveLength(0);
    });
  });

  describe('FK-CW-EXPORT-001: detects named import not exported by target', () => {
    it('flags import of name not exported by target file', () => {
      const ctx = makeContext({
        'src/app.ts': `import { nonExistent } from './utils/helper';`,
        'src/utils/helper.ts': `export function helper() { return 1; }`,
      });
      const result = analyzeCrossWiring(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-CW-EXPORT-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
    });

    it('passes when the named export exists in target', () => {
      const ctx = makeContext({
        'src/app.ts': `import { helper } from './utils/helper';`,
        'src/utils/helper.ts': `export function helper() { return 1; }`,
      });
      const result = analyzeCrossWiring(ctx);
      const exportFindings = result.findings.filter(f => f.ruleId === 'FK-CW-EXPORT-001');
      expect(exportFindings).toHaveLength(0);
    });

    it('skips barrel re-exports (export *)', () => {
      const ctx = makeContext({
        'src/app.ts': `import { anything } from './utils/index';`,
        'src/utils/index.ts': `export * from './helper';`,
      });
      const result = analyzeCrossWiring(ctx);
      const exportFindings = result.findings.filter(f => f.ruleId === 'FK-CW-EXPORT-001');
      expect(exportFindings).toHaveLength(0);
    });

    it('detects multiple missing exports in one import', () => {
      const ctx = makeContext({
        'src/app.ts': `import { foo, bar } from './utils/helper';`,
        'src/utils/helper.ts': `export const baz = 1;`,
      });
      const result = analyzeCrossWiring(ctx);
      const exportFindings = result.findings.filter(f => f.ruleId === 'FK-CW-EXPORT-001');
      expect(exportFindings).toHaveLength(2);
    });
  });

  describe('FK-CW-ROUTE-001: detects fetch to API path with no handler', () => {
    it('flags frontend fetch to endpoint with no backend handler', () => {
      const ctx = makeContext({
        'src/components/Dashboard.tsx': `const data = await fetch('/api/stats');`,
        'src/api/users/route.ts': [
          'import express from "express";',
          'const router = express.Router();',
          'router.get("/api/users", (req, res) => { res.json([]); });',
        ].join('\n'),
      });
      const result = analyzeCrossWiring(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-CW-ROUTE-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
    });

    it('passes when backend handler exists for the fetched path', () => {
      const ctx = makeContext({
        'src/components/Dashboard.tsx': `const data = await fetch('/api/users');`,
        'src/api/users/route.ts': [
          'import express from "express";',
          'const router = express.Router();',
          'router.get("/api/users", (req, res) => { res.json([]); });',
        ].join('\n'),
      });
      const result = analyzeCrossWiring(ctx);
      const routeFindings = result.findings.filter(f => f.ruleId === 'FK-CW-ROUTE-001');
      expect(routeFindings).toHaveLength(0);
    });

    it('does not flag when there are no backend routes at all', () => {
      const ctx = makeContext({
        'src/components/Dashboard.tsx': `const data = await fetch('/api/stats');`,
      });
      const result = analyzeCrossWiring(ctx);
      const routeFindings = result.findings.filter(f => f.ruleId === 'FK-CW-ROUTE-001');
      expect(routeFindings).toHaveLength(0);
    });

    it('matches FastAPI backend routes', () => {
      const ctx = makeContext({
        'src/components/Dashboard.tsx': `const data = await fetch('/api/items');`,
        'api/endpoints.py': [
          'from fastapi import APIRouter',
          'router = APIRouter()',
          '@router.get("/api/items")',
          'def get_items():',
          '    return []',
        ].join('\n'),
      });
      const result = analyzeCrossWiring(ctx);
      const routeFindings = result.findings.filter(f => f.ruleId === 'FK-CW-ROUTE-001');
      expect(routeFindings).toHaveLength(0);
    });
  });
});
