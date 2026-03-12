import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeSpecReality } from '../../../src/analyzers/spec-reality.js';
import { resetFindingCounter } from '../../../src/analyzers/base.js';
import { makeContext } from '../../helpers/make-context.js';

beforeEach(() => {
  resetFindingCounter();
});

describe('analyzeSpecReality', () => {
  describe('FK-SR-ENV-001: env var in .env.example not used in code', () => {
    it('detects env var defined but never referenced', () => {
      const ctx = makeContext({
        '.env.example': [
          'DATABASE_URL=postgresql://localhost:5432/mydb',
          'UNUSED_VAR=some-value',
        ].join('\n'),
        'src/config.ts': `const dbUrl = process.env.DATABASE_URL;`,
      });
      const result = analyzeSpecReality(ctx);
      const finding = result.findings.find(
        f => f.ruleId === 'FK-SR-ENV-001' && f.title.includes('UNUSED_VAR') && f.title.includes('never used'),
      );
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('medium');
    });

    it('passes when all env vars are used in code', () => {
      const ctx = makeContext({
        '.env.example': [
          'DATABASE_URL=postgresql://localhost:5432/mydb',
          'API_KEY=your-key',
        ].join('\n'),
        'src/config.ts': [
          'const dbUrl = process.env.DATABASE_URL;',
          'const apiKey = process.env.API_KEY;',
        ].join('\n'),
      });
      const result = analyzeSpecReality(ctx);
      const unusedFindings = result.findings.filter(
        f => f.ruleId === 'FK-SR-ENV-001' && f.title.includes('never used'),
      );
      expect(unusedFindings).toHaveLength(0);
    });

    it('flags env var used in code but not documented', () => {
      const ctx = makeContext({
        '.env.example': 'DATABASE_URL=postgresql://localhost:5432/mydb',
        'src/config.ts': [
          'const dbUrl = process.env.DATABASE_URL;',
          'const secret = process.env.STRIPE_SECRET_KEY;',
        ].join('\n'),
      });
      const result = analyzeSpecReality(ctx);
      const finding = result.findings.find(
        f => f.ruleId === 'FK-SR-ENV-001' && f.title.includes('STRIPE_SECRET_KEY'),
      );
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
    });
  });

  describe('FK-SR-PRISMA-001: Prisma model with no CRUD routes', () => {
    it('detects Prisma model with no corresponding usage', () => {
      const ctx = makeContext({
        'prisma/schema.prisma': [
          'model User {',
          '  id    Int    @id @default(autoincrement())',
          '  name  String',
          '}',
          '',
          'model AuditLog {',
          '  id    Int    @id @default(autoincrement())',
          '  event String',
          '}',
        ].join('\n'),
        'src/routes/users.ts': [
          'import { prisma } from "../db";',
          'const users = await prisma.user.findMany();',
        ].join('\n'),
      });
      const result = analyzeSpecReality(ctx);
      const finding = result.findings.find(
        f => f.ruleId === 'FK-SR-PRISMA-001' && f.title.includes('AuditLog'),
      );
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('medium');
    });

    it('passes when CRUD routes exist for the model', () => {
      const ctx = makeContext({
        'prisma/schema.prisma': [
          'model User {',
          '  id    Int    @id @default(autoincrement())',
          '  name  String',
          '}',
        ].join('\n'),
        'src/routes/users.ts': [
          'import { prisma } from "../db";',
          'const users = await prisma.user.findMany();',
        ].join('\n'),
      });
      const result = analyzeSpecReality(ctx);
      const prismaFindings = result.findings.filter(f => f.ruleId === 'FK-SR-PRISMA-001');
      expect(prismaFindings).toHaveLength(0);
    });
  });

  describe('skips checks when spec files do not exist', () => {
    it('returns no findings when no .env.example exists', () => {
      const ctx = makeContext({
        'src/config.ts': `const dbUrl = process.env.DATABASE_URL;`,
      });
      const result = analyzeSpecReality(ctx);
      const envFindings = result.findings.filter(f => f.ruleId === 'FK-SR-ENV-001');
      expect(envFindings).toHaveLength(0);
    });

    it('returns no findings when no schema.prisma exists', () => {
      const ctx = makeContext({
        'src/routes/users.ts': 'const users = await prisma.user.findMany();',
      });
      const result = analyzeSpecReality(ctx);
      const prismaFindings = result.findings.filter(f => f.ruleId === 'FK-SR-PRISMA-001');
      expect(prismaFindings).toHaveLength(0);
    });

    it('returns no findings when no OpenAPI spec exists', () => {
      const ctx = makeContext({
        'src/routes/users.ts': [
          'import express from "express";',
          'router.get("/api/users", (req, res) => { res.json([]); });',
        ].join('\n'),
      });
      const result = analyzeSpecReality(ctx);
      const specFindings = result.findings.filter(f => f.ruleId === 'FK-SR-OPENAPI-001');
      expect(specFindings).toHaveLength(0);
    });
  });
});
