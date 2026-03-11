import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, makeSmell, emptyResult } from './base.js';
import { searchFiles, filesMatching, extractSnippet } from '../utils/patterns.js';
import { isSourceFile, isTestFile } from '../utils/fs.js';

const prodFilter = (f: string) => isSourceFile(f) && !isTestFile(f);

export function analyzeFeatureReality(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  // FK-FR-MOCK-001: Mock data in production paths
  const mockPatterns = [
    /\bmockData\b/i,
    /\bfakeData\b/i,
    /\bdummyData\b/i,
    /\bsampleData\b/i,
    /\btestData\b/i,
    /\bplaceholder(Data|Items|List|Users|Results)\b/i,
  ];

  for (const pattern of mockPatterns) {
    const hits = searchFiles(ctx.fileContents, pattern, prodFilter);
    for (const hit of hits) {
      result.findings.push(makeFinding({
        ruleId: 'FK-FR-MOCK-001',
        title: 'Mock data present in production path',
        categoryId: 'FR',
        severity: 'critical',
        confidence: 'medium',
        labels: ['Mock Leakage', 'Misleading', 'Production-Blocking'],
        summary: `Found "${hit.match}" in production code.`,
        impact: 'Mock data shown to real users breaks trust.',
        location: { file: hit.file, startLine: hit.line },
        codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line),
        suggestedFix: 'Remove mock data from production paths. Isolate to test/dev boundaries.',
      }));
    }
  }

  // Smell: mock leakage count
  const mockFiles = filesMatching(ctx.fileContents, /\b(mock|fake|dummy|sample|placeholder)(Data|Items|List|Users|Response)\b/i, prodFilter);
  if (mockFiles.length > 0) {
    result.smellHits.push(makeSmell('SMELL-MOCK-LEAKAGE', 'Mock leakage', mockFiles.length));
  }

  // FK-FR-STATE-001: False success patterns
  const falseSuccessPatterns = searchFiles(
    ctx.fileContents,
    /toast\.(success|show)|showSuccess|setSuccess\(true\)|notify\(\s*['"`].*success/i,
    prodFilter,
  );

  for (const hit of falseSuccessPatterns) {
    // Check if success is shown before await
    const file = ctx.fileContents.get(hit.file);
    if (!file) continue;
    const lines = file.split('\n');
    const startLine = Math.max(0, hit.line - 10);
    const region = lines.slice(startLine, hit.line).join('\n');

    // Success toast before await/then = suspicious
    const hasAwaitBefore = /await\s/.test(region) || /\.then\(/.test(region);
    if (!hasAwaitBefore) {
      result.findings.push(makeFinding({
        ruleId: 'FK-FR-STATE-001',
        title: 'Success state shown without confirmed async completion',
        categoryId: 'FR',
        severity: 'high',
        confidence: 'medium',
        labels: ['Fake Flow', 'Misleading'],
        summary: `Success notification at line ${hit.line} may fire before operation completes.`,
        impact: 'Users believe action succeeded when it may not have.',
        location: { file: hit.file, startLine: hit.line },
        codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line, 5, 2),
        suggestedFix: 'Only show success after confirmed async completion.',
      }));
      result.smellHits.push(makeSmell('SMELL-FAKE-SUCCESS', 'Fake success state', 1));
    }
  }

  // FK-FR-CLAIM-001: TODO/FIXME/HACK in critical code (JS // and Python #)
  const todoHits = searchFiles(ctx.fileContents, /(?:\/\/|#)\s*(TODO|FIXME|HACK|TEMP|XXX|PLACEHOLDER)\b/i, prodFilter);
  const criticalTodos = todoHits.filter(h => {
    const path = h.file.toLowerCase();
    return path.includes('api') || path.includes('auth') || path.includes('payment') ||
      path.includes('checkout') || path.includes('submit') || path.includes('save') ||
      path.includes('action') || path.includes('mutation') || path.includes('server') ||
      path.includes('route') || path.includes('service') || path.includes('endpoint') ||
      path.includes('handler') || path.includes('controller');
  });

  if (criticalTodos.length > 0) {
    for (const hit of criticalTodos.slice(0, 5)) {
      result.findings.push(makeFinding({
        ruleId: 'FK-FR-CLAIM-001',
        title: 'TODO/FIXME/HACK in critical path',
        categoryId: 'FR',
        severity: 'high',
        confidence: 'high',
        labels: ['Incomplete'],
        summary: `"${hit.context.slice(0, 80)}" in ${hit.file}:${hit.line}`,
        impact: 'Incomplete logic in a critical code path.',
        location: { file: hit.file, startLine: hit.line },
        codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line),
        suggestedFix: 'Complete the implementation or clearly mark the feature as incomplete.',
      }));
    }
    result.smellHits.push(makeSmell('SMELL-FEATURE-SHAPED-PLACEHOLDER', 'Feature-shaped placeholder', criticalTodos.length));
  }

  // Hardcoded demo values
  const hardcodedHits = searchFiles(
    ctx.fileContents,
    /['"`](Lorem ipsum|John Doe|Jane Doe|test@test\.com|example@|foo@bar|123-456-7890|acme|sample company)['"`]/i,
    prodFilter,
  );
  for (const hit of hardcodedHits) {
    result.findings.push(makeFinding({
      ruleId: 'FK-FR-MOCK-001',
      title: 'Hardcoded demo/placeholder value in production path',
      categoryId: 'FR',
      severity: 'medium',
      confidence: 'high',
      labels: ['Mock Leakage', 'Misleading'],
      summary: `Hardcoded demo value "${hit.match}" found.`,
      impact: 'Demo values visible to real users undermine credibility.',
      location: { file: hit.file, startLine: hit.line },
      codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line),
      suggestedFix: 'Replace with real data sources or remove.',
    }));
  }

  return result;
}
