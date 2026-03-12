import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeDataModel } from '../../../src/analyzers/data-model.js';
import { resetFindingCounter } from '../../../src/analyzers/base.js';
import { makeContext } from '../../helpers/make-context.js';

beforeEach(() => {
  resetFindingCounter();
});

describe('analyzeDataModel', () => {
  describe('FK-DM-TENANT-001: unscoped queries', () => {
    it('detects findMany() without scope', () => {
      const ctx = makeContext({
        'src/api/users.ts': [
          'const users = await prisma.user.findMany();',
          'return users;',
        ].join('\n'),
      });
      const result = analyzeDataModel(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-DM-TENANT-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
    });

    it('passes when query has where clause with userId', () => {
      const ctx = makeContext({
        'src/api/users.ts': [
          'const users = await prisma.user.findMany({',
          '  where: { orgId: ctx.orgId }',
          '});',
        ].join('\n'),
      });
      const result = analyzeDataModel(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-DM-TENANT-001')).toHaveLength(0);
    });

    it('passes when query has limit/pagination', () => {
      const ctx = makeContext({
        'src/api/users.ts': [
          'const users = await prisma.user.findMany();',
          'const limited = users.slice(0, 10);',
        ].join('\n'),
      });
      const result = analyzeDataModel(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-DM-TENANT-001')).toHaveLength(0);
    });

    it('detects Python SQLAlchemy unscoped query', () => {
      const ctx = makeContext({
        'src/api/users.py': `users = session.query(User).all()`,
      });
      const result = analyzeDataModel(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-DM-TENANT-001');
      expect(finding).toBeDefined();
    });

    it('passes when Python query has filter', () => {
      const ctx = makeContext({
        'src/api/users.py': [
          'users = session.query(User).all()',
          'filtered = users.filter(user_id=current_user.id)',
        ].join('\n'),
      });
      const result = analyzeDataModel(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-DM-TENANT-001')).toHaveLength(0);
    });

    it('detects Django .objects.all()', () => {
      const ctx = makeContext({
        'src/views.py': `items = Item.objects.all()`,
      });
      const result = analyzeDataModel(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-DM-TENANT-001');
      expect(finding).toBeDefined();
    });
  });

  describe('FK-DM-SCHEMA-001: missing timestamps in Prisma', () => {
    it('detects Prisma model without timestamps', () => {
      const ctx = makeContext({
        'schema.prisma': [
          'model User {',
          '  id    String @id',
          '  name  String',
          '  email String',
          '}',
        ].join('\n'),
      });
      const result = analyzeDataModel(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-DM-SCHEMA-001');
      expect(finding).toBeDefined();
      expect(finding!.title).toContain('User');
    });

    it('passes when model has createdAt', () => {
      const ctx = makeContext({
        'schema.prisma': [
          'model User {',
          '  id        String   @id',
          '  name      String',
          '  createdAt DateTime @default(now())',
          '  updatedAt DateTime @updatedAt',
          '}',
        ].join('\n'),
      });
      const result = analyzeDataModel(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-DM-SCHEMA-001')).toHaveLength(0);
    });
  });

  describe('FK-DM-NULLABLE-001: nullable columns without defaults', () => {
    it('detects nullable critical column without default', () => {
      const ctx = makeContext({
        'src/models.py': [
          'from sqlalchemy import Column, String',
          'class User(Base):',
          '    email = Column(String, nullable=True)',
        ].join('\n'),
      });
      const result = analyzeDataModel(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-DM-NULLABLE-001');
      expect(finding).toBeDefined();
    });

    it('passes when column has server_default', () => {
      const ctx = makeContext({
        'src/models.py': [
          'from sqlalchemy import Column, String',
          'class User(Base):',
          '    status = Column(String, nullable=True, server_default="active")',
        ].join('\n'),
      });
      const result = analyzeDataModel(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-DM-NULLABLE-001')).toHaveLength(0);
    });
  });

  describe('FK-DM-DEMO-001: seed data in production paths', () => {
    it('detects import of seed data', () => {
      const ctx = makeContext({
        'src/app.ts': `import { users } from '../fixtures/data';`,
      });
      const result = analyzeDataModel(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-DM-DEMO-001');
      expect(finding).toBeDefined();
    });

    it('skips imports in test files', () => {
      const ctx = makeContext({
        'src/tests/app.test.ts': `import { users } from '../fixtures/data';`,
      });
      const result = analyzeDataModel(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-DM-DEMO-001')).toHaveLength(0);
    });
  });
});
