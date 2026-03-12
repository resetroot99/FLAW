import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeValidation } from '../../../src/analyzers/validation.js';
import { resetFindingCounter } from '../../../src/analyzers/base.js';
import { makeContext } from '../../helpers/make-context.js';

beforeEach(() => {
  resetFindingCounter();
});

describe('analyzeValidation', () => {
  describe('FK-VB-SERVER-001: client-side validation without server-side', () => {
    it('detects client schema without server validation', () => {
      const ctx = makeContext({
        'src/components/form.ts': `const schema = z.object({ name: z.string() });`,
        'src/api/handler.ts': [
          'export default function POST(req) {',
          '  const data = req.body;',
          '  return save(data);',
          '}',
        ].join('\n'),
      });
      const result = analyzeValidation(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-VB-SERVER-001');
      expect(finding).toBeDefined();
    });

    it('passes when server also has validation', () => {
      const ctx = makeContext({
        'src/components/form.ts': `const schema = z.object({ name: z.string() });`,
        'src/api/handler.ts': [
          'import { z } from "zod";',
          'const schema = z.object({ name: z.string() });',
          'export default function POST(req) {',
          '  const data = schema.parse(req.body);',
          '  return save(data);',
          '}',
        ].join('\n'),
      });
      const result = analyzeValidation(ctx);
      const serverMissing = result.findings.find(f =>
        f.ruleId === 'FK-VB-SERVER-001' && f.title.includes('Client-side validation')
      );
      expect(serverMissing).toBeUndefined();
    });
  });

  describe('FK-VB-SERVER-001: request body without validation', () => {
    it('detects raw req.body usage without validation', () => {
      const ctx = makeContext({
        'src/api/route.ts': [
          'export function POST(req) {',
          '  const name = req.body.name;',
          '  return saveUser(name);',
          '}',
        ].join('\n'),
      });
      const result = analyzeValidation(ctx);
      const finding = result.findings.find(f =>
        f.ruleId === 'FK-VB-SERVER-001' && f.title.includes('Request body')
      );
      expect(finding).toBeDefined();
    });

    it('passes when validation exists nearby', () => {
      const ctx = makeContext({
        'src/api/route.ts': [
          'import { z } from "zod";',
          'const schema = z.object({ name: z.string() });',
          'export function POST(req) {',
          '  const data = schema.parse(req.body);',
          '  const name = req.body.name;',
          '  return saveUser(name);',
          '}',
        ].join('\n'),
      });
      const result = analyzeValidation(ctx);
      const finding = result.findings.find(f =>
        f.ruleId === 'FK-VB-SERVER-001' && f.title.includes('Request body')
      );
      expect(finding).toBeUndefined();
    });
  });

  describe('FK-VB-UNBOUNDED-001: Pydantic unbounded fields', () => {
    it('detects unbounded str field in Request model', () => {
      const ctx = makeContext({
        'src/models.py': [
          'from pydantic import BaseModel',
          'class UserCreateRequest(BaseModel):',
          '    username: str',
          '    bio: str',
          '    tags: list[str]',
        ].join('\n'),
      });
      const result = analyzeValidation(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-VB-UNBOUNDED-001');
      expect(finding).toBeDefined();
      expect(finding!.summary).toContain('without size constraints');
    });

    it('passes when Field constraints exist', () => {
      const ctx = makeContext({
        'src/models.py': [
          'from pydantic import BaseModel, Field',
          'class UserCreateRequest(BaseModel):',
          '    bio: str = Field(max_length=500)',
          '    tags: list[str] = Field(max_items=10)',
        ].join('\n'),
      });
      const result = analyzeValidation(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-VB-UNBOUNDED-001')).toHaveLength(0);
    });

    it('skips common field names like id, name, type, status', () => {
      const ctx = makeContext({
        'src/models.py': [
          'from pydantic import BaseModel',
          'class ItemCreateRequest(BaseModel):',
          '    name: str',
          '    type: str',
          '    status: str',
        ].join('\n'),
      });
      const result = analyzeValidation(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-VB-UNBOUNDED-001')).toHaveLength(0);
    });
  });

  describe('FK-VB-RAWDICT-001: raw dict in FastAPI routes', () => {
    it('detects dict parameter in POST route', () => {
      const ctx = makeContext({
        'src/api/endpoints.py': [
          '@router.post("/items")',
          'async def create_item(data: dict):',
          '    return {"id": 1}',
        ].join('\n'),
      });
      const result = analyzeValidation(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-VB-RAWDICT-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
    });

    it('passes when Pydantic model is used', () => {
      const ctx = makeContext({
        'src/api/endpoints.py': [
          '@router.post("/items")',
          'async def create_item(data: ItemCreateRequest):',
          '    return {"id": 1}',
        ].join('\n'),
      });
      const result = analyzeValidation(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-VB-RAWDICT-001')).toHaveLength(0);
    });
  });
});
