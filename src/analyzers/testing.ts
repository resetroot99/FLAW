// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, emptyResult } from './base.js';
import { filesMatching, searchFiles, countPattern, extractSnippet } from '../utils/patterns.js';
import { isTestFile, isSourceFile } from '../utils/fs.js';

export function analyzeTesting(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  const sourceFiles = ctx.files.filter(f => isSourceFile(f) && !isTestFile(f));
  const testFiles = ctx.files.filter(isTestFile);

  // No tests at all
  if (testFiles.length === 0 && sourceFiles.length > 5) {
    result.findings.push(makeFinding({
      ruleId: 'FK-TV-COVERAGE-001',
      title: 'No test files found',
      categoryId: 'TV',
      severity: 'high',
      confidence: 'high',
      labels: ['Unverified'],
      summary: `${sourceFiles.length} source files with zero test files.`,
      impact: 'No automated verification that anything works.',
      location: { file: '.' },
      suggestedFix: 'Add tests for critical business logic and API handlers.',
    }));
    return result;
  }

  // Low test ratio
  if (sourceFiles.length > 10 && testFiles.length > 0) {
    const ratio = testFiles.length / sourceFiles.length;
    if (ratio < 0.1) {
      result.findings.push(makeFinding({
        ruleId: 'FK-TV-COVERAGE-001',
        title: 'Very low test-to-source ratio',
        categoryId: 'TV',
        severity: 'medium',
        confidence: 'high',
        labels: ['Unverified'],
        summary: `${testFiles.length} test files for ${sourceFiles.length} source files (${(ratio * 100).toFixed(1)}%).`,
        impact: 'Most code paths are unverified.',
        location: { file: '.' },
        evidenceRefs: testFiles.slice(0, 5).map(f => `Test: ${f}`),
        suggestedFix: 'Prioritize tests for critical paths: auth, payments, core workflows.',
      }));
    }
  }

  // FK-TV-RUNTIME-001: Critical files without corresponding tests
  const criticalPatterns = ['auth', 'payment', 'checkout', 'billing', 'api', 'mutation', 'action'];
  for (const pattern of criticalPatterns) {
    const criticalFiles = sourceFiles.filter(f => f.toLowerCase().includes(pattern));
    if (criticalFiles.length === 0) continue;

    const hasTests = testFiles.some(t => t.toLowerCase().includes(pattern));
    if (!hasTests) {
      result.findings.push(makeFinding({
        ruleId: 'FK-TV-RUNTIME-001',
        title: `No tests for ${pattern}-related code`,
        categoryId: 'TV',
        severity: 'high',
        confidence: 'medium',
        labels: ['Unverified'],
        summary: `Found ${criticalFiles.length} ${pattern}-related files but no corresponding tests.`,
        impact: `Critical ${pattern} logic is unverified.`,
        location: { file: criticalFiles[0] },
        evidenceRefs: criticalFiles.slice(0, 5).map(f => `Untested: ${f}`),
        suggestedFix: `Add tests covering ${pattern} flows.`,
      }));
    }
  }

  // FK-TV-CONSOLE-001: console.error in production code (might indicate known issues)
  const consoleErrors = searchFiles(
    ctx.fileContents,
    /console\.error\(/,
    (f) => isSourceFile(f) && !isTestFile(f),
  );
  if (consoleErrors.length > 5) {
    result.findings.push(makeFinding({
      ruleId: 'FK-TV-CONSOLE-001',
      title: 'Excessive console.error usage',
      categoryId: 'TV',
      severity: 'low',
      confidence: 'medium',
      labels: ['Fragile'],
      summary: `${consoleErrors.length} console.error calls found — may indicate unresolved error paths.`,
      impact: 'Console-only errors are invisible to users and monitoring.',
      location: { file: consoleErrors[0].file, startLine: consoleErrors[0].line },
      codeSnippet: extractSnippet(ctx.fileContents, consoleErrors[0].file, consoleErrors[0].line),
      evidenceRefs: consoleErrors.slice(0, 5).map(h => `${h.file}:${h.line}`),
      suggestedFix: 'Replace with proper error handling and monitoring.',
    }));
  }

  return result;
}
