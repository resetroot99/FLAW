import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, makeSmell, emptyResult } from './base.js';
import { searchFiles, filesMatching, extractSnippet } from '../utils/patterns.js';
import { isTestFile } from '../utils/fs.js';

const srcFilter = (f: string) => !isTestFile(f);

export function analyzeDataModel(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  // FK-DM-TENANT-001: Queries without tenant/user scoping
  // JS/TS ORM patterns
  const queryWithoutScope = searchFiles(
    ctx.fileContents,
    /\.findMany\(\s*\)|\bfindAll\(\s*\)|\.\w+\.find\(\s*\{?\s*\}?\s*\)/,
    (f) => srcFilter(f) && /\.(ts|js)$/.test(f),
  );
  // Python ORM patterns: SQLAlchemy session.query(...).all(), select(...), .objects.all()
  const pyQueryWithoutScope = searchFiles(
    ctx.fileContents,
    /session\.query\([^)]+\)\.all\(\)|\.execute\(\s*select\([^)]+\)\s*\)|\.objects\.all\(\)/,
    (f) => srcFilter(f) && /\.py$/.test(f),
  );
  for (const hit of [...queryWithoutScope, ...pyQueryWithoutScope]) {
    const content = ctx.fileContents.get(hit.file)!;
    const lines = content.split('\n');
    const region = lines.slice(Math.max(0, hit.line - 5), Math.min(lines.length, hit.line + 10)).join('\n');
    const hasScope = /(where|filter|userId|tenantId|orgId|ownerId|scope|belongsTo|tenant_id|user_id|org_id|owner_id|company_id)/i.test(region);
    // Check for limit/pagination in context — bounded queries are low risk
    const hasLimit = /(\.limit\(|\.take\(|LIMIT\s+\d|\$limit|\.slice\(|\.head\(|pagination|paginate|offset|skip\s*[:=]|limit\s*[:=])/i.test(region);

    if (!hasScope && !hasLimit) {
      result.findings.push(makeFinding({
        ruleId: 'FK-DM-TENANT-001',
        title: 'Unscoped query may return all records',
        categoryId: 'DM',
        severity: 'high',
        confidence: 'low',
        labels: ['Unsafe'],
        summary: `Query at ${hit.file}:${hit.line} fetches without visible scoping.`,
        impact: 'May expose data across users or tenants.',
        location: { file: hit.file, startLine: hit.line },
        codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line, 2, 4),
        suggestedFix: 'Add user/tenant scoping to the query.',
      }));
    }
  }

  // FK-DM-SCHEMA-001: Schema with optional fields that should be required
  const schemaFiles = filesMatching(ctx.fileContents, /model\s+\w+\s*\{|CREATE TABLE|schema\.\w+Table|class\s+\w+\(.*Base\)/i, srcFilter);
  // Check for Prisma models missing required fields
  for (const file of schemaFiles) {
    const content = ctx.fileContents.get(file)!;
    if (/\.prisma$/.test(file)) {
      // Check for models without timestamps
      const models = content.match(/model\s+\w+\s*\{[^}]+\}/g) || [];
      for (const model of models) {
        const modelName = model.match(/model\s+(\w+)/)?.[1] || 'Unknown';
        if (!/createdAt|created_at|updatedAt|updated_at/i.test(model)) {
          result.findings.push(makeFinding({
            ruleId: 'FK-DM-SCHEMA-001',
            title: `Model ${modelName} lacks timestamp fields`,
            categoryId: 'DM',
            severity: 'low',
            confidence: 'high',
            labels: ['Incomplete'],
            summary: `Model ${modelName} has no createdAt/updatedAt fields.`,
            impact: 'No audit trail for record changes.',
            location: { file },
            suggestedFix: 'Add createdAt and updatedAt timestamp fields.',
          }));
        }
      }
    }
  }

  // FK-DM-NULLABLE-001: SQLAlchemy columns that are Optional/nullable without defaults
  for (const [file, content] of ctx.fileContents) {
    if (!/\.py$/.test(file) || isTestFile(file)) continue;
    if (!/class\s+\w+\(.*Base\)/.test(content)) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Column(..., nullable=True) or Optional[...] = Column(...) without server_default
      if (/Column\(/.test(line) && /nullable\s*=\s*True/.test(line) && !/server_default|default=/.test(line)) {
        const colName = line.match(/(\w+)\s*(?::\s*\w+)?\s*=\s*(?:mapped_column|Column)/)?.[1];
        if (colName && /(name|title|status|type|email|role)$/i.test(colName)) {
          result.findings.push(makeFinding({
            ruleId: 'FK-DM-NULLABLE-001',
            title: `Critical column "${colName}" is nullable without default`,
            categoryId: 'DM',
            severity: 'medium',
            confidence: 'medium',
            labels: ['Fragile', 'Incomplete'],
            summary: `${file}:${i + 1} — "${colName}" is nullable but looks like a required field.`,
            impact: 'NULL values in required fields cause downstream errors.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 1, 2),
            suggestedFix: `Make "${colName}" non-nullable or add a server_default.`,
          }));
        }
      }
    }
  }

  // FK-DM-DEMO-001: Seed data referenced in production paths
  const seedRefs = searchFiles(
    ctx.fileContents,
    /^import\s+.*['"`].*\b(seed|fixtures?|demo|sample)\b.*['"`]|^(?:const|let|var)\s+.*=\s*require\(.*\b(seed|fixtures?|demo|sample)\b/i,
    (f) => srcFilter(f) && !isTestFile(f) && !/seed|fixture|demo|test|spec|analyz/i.test(f),
  );
  for (const hit of seedRefs) {
    result.findings.push(makeFinding({
      ruleId: 'FK-DM-DEMO-001',
      title: 'Seed/demo data imported in production path',
      categoryId: 'DM',
      severity: 'medium',
      confidence: 'medium',
      labels: ['Mock Leakage'],
      summary: `Seed or demo data imported in ${hit.file}:${hit.line}.`,
      impact: 'Production logic may depend on test/demo data.',
      location: { file: hit.file, startLine: hit.line },
      codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line),
      suggestedFix: 'Remove seed/demo imports from production code.',
    }));
  }

  return result;
}
