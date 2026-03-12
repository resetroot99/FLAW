import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeBackendIntegrity } from '../../../src/analyzers/backend-integrity.js';
import { resetFindingCounter } from '../../../src/analyzers/base.js';
import { makeContext } from '../../helpers/make-context.js';

beforeEach(() => {
  resetFindingCounter();
});

describe('analyzeBackendIntegrity', () => {
  describe('FK-BE-PERSIST-001: write handlers without DB ops', () => {
    it('detects POST handler without database operation', () => {
      const ctx = makeContext({
        'src/api/route.ts': [
          'export function POST(req) {',
          '  return Response.json({ success: true });',
          '}',
        ].join('\n'),
      });
      const result = analyzeBackendIntegrity(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-BE-PERSIST-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
      expect(result.smellHits.some(s => s.id === 'SMELL-DISCONNECTED-BACKEND')).toBe(true);
    });

    it('passes when handler uses prisma', () => {
      const ctx = makeContext({
        'src/api/route.ts': [
          'export function POST(req) {',
          '  const user = await prisma.user.create({ data: req.body });',
          '  return Response.json(user);',
          '}',
        ].join('\n'),
      });
      const result = analyzeBackendIntegrity(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-BE-PERSIST-001')).toHaveLength(0);
    });

    it('passes when handler uses generic db call', () => {
      const ctx = makeContext({
        'src/api/route.ts': [
          'export function POST(req) {',
          '  await db.insert(data);',
          '  return Response.json({ ok: true });',
          '}',
        ].join('\n'),
      });
      const result = analyzeBackendIntegrity(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-BE-PERSIST-001')).toHaveLength(0);
    });
  });

  describe('FK-BE-ENDPOINT-001: client fetches non-existent endpoints', () => {
    it('detects client fetch to endpoint with no matching backend route', () => {
      const ctx = makeContext({
        'src/components/Page.tsx': `fetch('/api/v1/missing')`,
        'src/api/endpoints.py': [
          '@router.get("/api/v1/users")',
          'def get_users():',
          '    return []',
        ].join('\n'),
      });
      const result = analyzeBackendIntegrity(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-BE-ENDPOINT-001');
      expect(finding).toBeDefined();
    });

    it('passes when client fetch matches a backend route', () => {
      const ctx = makeContext({
        'src/components/Page.tsx': `fetch('/api/v1/users')`,
        'src/api/endpoints.py': [
          '@router.get("/api/v1/users")',
          'def get_users():',
          '    return []',
        ].join('\n'),
      });
      const result = analyzeBackendIntegrity(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-BE-ENDPOINT-001')).toHaveLength(0);
    });
  });

  describe('clean backend code', () => {
    it('returns no findings for well-structured code', () => {
      const ctx = makeContext({
        'src/utils/helpers.ts': [
          'export function formatDate(d: Date) {',
          '  return d.toISOString();',
          '}',
        ].join('\n'),
      });
      const result = analyzeBackendIntegrity(ctx);
      expect(result.findings).toHaveLength(0);
    });
  });
});
