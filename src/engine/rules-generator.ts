// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
/**
 * Agent Rules File Generator
 * Creates .cursorrules / agent rules files with project-specific coding standards
 * derived from FLAW findings.
 */

import type { Finding, CategoryScore, AuditReport } from '../types/index.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function generateAgentRules(report: AuditReport): string {
  const { project, findings, scores, smellIndex, summary } = report;
  const open = findings.filter(f => f.status === 'open');

  // Count findings by category
  const byCat = new Map<string, number>();
  for (const f of open) byCat.set(f.categoryId, (byCat.get(f.categoryId) || 0) + 1);

  // Derive rules from what's broken
  const rules: string[] = [];
  const context: string[] = [];

  // Project context
  context.push(`# Project: ${project.name}`);
  if (project.framework) context.push(`Framework: ${project.framework}`);
  context.push(`FLAW Score: ${summary.totalScore}/100 (${summary.rating})`);
  context.push(`Open issues: ${open.length} (${summary.criticalCount} critical, ${summary.highCount} high)`);

  // Security rules
  if (byCat.get('SA')) {
    const authFindings = open.filter(f => f.ruleId === 'FK-SA-AUTH-001');
    const secretFindings = open.filter(f => f.ruleId === 'FK-SA-SECRET-001');

    rules.push('## Security Rules');
    rules.push('- NEVER hardcode secrets, API keys, or passwords in source code. Always use environment variables.');
    rules.push('- EVERY API route must have authentication. No exceptions unless explicitly marked as public.');
    if (authFindings.length > 0) {
      const files = authFindings.map(f => f.location.file).slice(0, 5);
      rules.push(`- These routes need auth added: ${files.join(', ')}`);
    }
    if (secretFindings.length > 0) {
      rules.push('- Check .gitignore covers .env files. Rotate any secrets that may have been exposed.');
    }
    rules.push('- Always validate resource ownership (check user_id/tenant_id) before returning data.');
    rules.push('');
  }

  // Validation rules
  if (byCat.get('VB')) {
    rules.push('## Input Validation Rules');
    rules.push('- ALWAYS validate input on the server side, even if the frontend already validates.');
    rules.push('- Use typed models (Pydantic/zod/joi) for all request bodies. Never accept raw dict/any.');
    rules.push('- Add max_length constraints to all string fields in input models.');
    rules.push('- Add size limits to all list/array fields in input models.');
    rules.push('');
  }

  // Error handling rules
  if (byCat.get('EH')) {
    const silentCount = open.filter(f => f.ruleId.startsWith('FK-EH-SILENT')).length;
    rules.push('## Error Handling Rules');
    rules.push('- NEVER use empty catch/except blocks. Always log the error at minimum.');
    rules.push('- NEVER use `except: pass` or `catch(e) {}`. Handle or propagate every error.');
    if (silentCount > 5) {
      rules.push(`- WARNING: This project has ${silentCount} silent error handlers. Fix these as you encounter them.`);
    }
    rules.push('- Show success messages ONLY after the async operation confirms success.');
    rules.push('- Every API call needs error handling with user-friendly error states.');
    rules.push('');
  }

  // Frontend wiring rules
  if (byCat.get('FW')) {
    rules.push('## Frontend Rules');
    rules.push('- Every button must have an onClick handler or be type="submit" inside a form.');
    rules.push('- Every form must have an onSubmit handler with e.preventDefault().');
    rules.push('- Remove console.log from event handlers before committing.');
    rules.push('- useEffect hooks must include all dependencies and return cleanup functions for subscriptions.');
    rules.push('- Always await async calls. Never fire-and-forget.');
    rules.push('');
  }

  // Backend rules
  if (byCat.get('BE')) {
    rules.push('## Backend / API Rules');
    rules.push('- Use a consistent response format across all endpoints: { data, error }.');
    rules.push('- Every frontend fetch URL must match an existing backend route.');
    rules.push('- Do not comment out router registrations. Either the route works or delete it.');
    rules.push('- Persist data to the database. Never store state only in memory/variables.');
    rules.push('');
  }

  // Data model rules
  if (byCat.get('DM')) {
    rules.push('## Data Model Rules');
    rules.push('- Every query must be scoped to the current user/tenant. No unscoped .findAll() or .all().');
    rules.push('- Add createdAt and updatedAt timestamps to every model.');
    rules.push('- Required fields (name, email, status) must be non-nullable with defaults.');
    rules.push('- Never import seed/demo data in production code paths.');
    rules.push('');
  }

  // Feature reality rules
  if (byCat.get('FR')) {
    const todoCount = open.filter(f => f.ruleId === 'FK-FR-CLAIM-001').length;
    const stubCount = open.filter(f => f.ruleId === 'FK-FR-STUB-001').length;
    rules.push('## Feature Completeness Rules');
    rules.push('- Do not ship functions that are stubs (just `pass` or `return None`). Implement or delete.');
    rules.push('- Remove mock/dummy/fake data from production code paths.');
    if (todoCount > 0) {
      rules.push(`- Resolve all ${todoCount} TODO/FIXME/HACK comments in critical paths before launch.`);
    }
    if (stubCount > 0) {
      rules.push(`- ${stubCount} stub functions need real implementations.`);
    }
    rules.push('');
  }

  // Maintainability rules
  if (byCat.get('MH')) {
    rules.push('## Code Quality Rules');
    rules.push('- Keep files under 300 lines. Split large files into focused modules.');
    rules.push('- Delete commented-out code. Git has the history.');
    rules.push('- Do not duplicate logic. Extract shared code into a utility function.');
    rules.push('');
  }

  // Testing rules
  if (byCat.get('TV')) {
    rules.push('## Testing Rules');
    rules.push('- Every API route must have at least one test (happy path + error case).');
    rules.push('- Auth, payment, and data mutation paths require comprehensive tests.');
    rules.push('- Run tests before every commit.');
    rules.push('');
  }

  // Known problem files
  const hotFiles = new Map<string, number>();
  for (const f of open) {
    hotFiles.set(f.location.file, (hotFiles.get(f.location.file) || 0) + 1);
  }
  const sortedHotFiles = [...hotFiles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (sortedHotFiles.length > 0) {
    rules.push('## Known Problem Files');
    rules.push('These files have the most issues. Be extra careful when modifying them:');
    for (const [file, count] of sortedHotFiles) {
      rules.push(`- \`${file}\` — ${count} issue${count > 1 ? 's' : ''}`);
    }
    rules.push('');
  }

  const output = [
    ...context,
    '',
    '---',
    '',
    '# Coding Rules (auto-generated by FLAW)',
    '',
    'Follow these rules when writing or modifying code in this project.',
    'These rules are derived from real issues found in the codebase.',
    '',
    ...rules,
  ].join('\n');

  return output;
}

export function exportAgentRules(report: AuditReport, outputDir: string, format: 'cursorrules' | 'claude' = 'cursorrules'): string {
  const content = generateAgentRules(report);
  const filename = format === 'claude' ? 'AGENT_RULES.md' : '.cursorrules';
  const path = join(outputDir, filename);
  writeFileSync(path, content);
  return path;
}
