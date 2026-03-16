// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
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

  // FK-FR-SEED-001: Seed data auto-loads in production path
  const seedFuncDefRegex = /\b(def|function|const|async function)\s+(seed_\w+|populate_\w+|load_fixtures|create_demo|init_data|load_sample|load_demo)\b/;
  const seedFuncNameRegex = /\b(seed_\w+|populate_\w+|load_fixtures|create_demo|init_data|load_sample|load_demo)\b/g;
  const startupPatterns = /\b(lifespan|on_event\s*\(\s*['"`]startup|on_startup|app\.listen|app\.on\s*\(\s*['"`]ready)/;

  // Collect seed/demo function names from definitions
  const seedFuncDefs = searchFiles(ctx.fileContents, seedFuncDefRegex, prodFilter);
  const seedFuncNames = new Set(seedFuncDefs.map(h => {
    const m = h.context.match(/\b(seed_\w+|populate_\w+|load_fixtures|create_demo|init_data|load_sample|load_demo)\b/);
    return m ? m[0] : '';
  }).filter(Boolean));

  // Find files with startup hooks
  const startupFiles = filesMatching(ctx.fileContents, startupPatterns, prodFilter);

  for (const file of startupFiles) {
    const content = ctx.fileContents.get(file);
    if (!content) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineMatches = lines[i].match(seedFuncNameRegex);
      if (!lineMatches) continue;

      for (const funcName of lineMatches) {
        if (!seedFuncNames.has(funcName)) continue;
        result.findings.push(makeFinding({
          ruleId: 'FK-FR-SEED-001',
          title: 'Seed data auto-loads in production path',
          categoryId: 'FR',
          severity: 'critical',
          confidence: 'medium',
          labels: ['Misleading', 'Production-Blocking'],
          summary: `Seed/demo function "${funcName}" is called from a startup hook in ${file}:${i + 1}.`,
          impact: 'Demo/seed data loads automatically on every app startup in production.',
          location: { file, startLine: i + 1 },
          codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 3, 2),
          suggestedFix: 'Guard seed calls with an environment check (e.g., if NODE_ENV !== "production") or require explicit invocation.',
        }));
        result.smellHits.push(makeSmell('SMELL-SEED-AUTOLOAD', 'Demo data auto-loads in production', 1));
      }
    }
  }

  // Also check for seed functions called at module scope (no startup hook, but no guard either)
  for (const def of seedFuncDefs) {
    const content = ctx.fileContents.get(def.file);
    if (!content) continue;
    const lines = content.split('\n');
    const funcName = def.context.match(/\b(seed_\w+|populate_\w+|load_fixtures|create_demo|init_data|load_sample|load_demo)\b/);
    if (!funcName) continue;

    // Look for bare calls at module scope (not inside a function or class body, no if __name__ guard)
    const hasMainGuard = /if\s+__name__\s*==\s*['"`]__main__['"`]|if\s*\(\s*require\.main\s*===\s*module\s*\)/.test(content);
    if (hasMainGuard) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip the definition line itself, comments, and indented lines (inside functions)
      if (i + 1 === def.line) continue;
      if (/^\s*(#|\/\/)/.test(line)) continue;

      // Module-scope call: starts at column 0 (no indentation) and calls the function
      const callPattern = new RegExp(`^${funcName[0]}\\s*\\(`);
      if (callPattern.test(line)) {
        result.findings.push(makeFinding({
          ruleId: 'FK-FR-SEED-001',
          title: 'Seed data auto-loads in production path',
          categoryId: 'FR',
          severity: 'critical',
          confidence: 'medium',
          labels: ['Misleading', 'Production-Blocking'],
          summary: `Seed/demo function "${funcName[0]}" is called at module scope in ${def.file}:${i + 1} without an environment guard.`,
          impact: 'Demo/seed data loads automatically on every app startup in production.',
          location: { file: def.file, startLine: i + 1 },
          codeSnippet: extractSnippet(ctx.fileContents, def.file, i + 1, 2, 2),
          suggestedFix: 'Wrap in if __name__ == "__main__" or an environment check.',
        }));
        result.smellHits.push(makeSmell('SMELL-SEED-AUTOLOAD', 'Demo data auto-loads in production', 1));
      }
    }
  }

  return result;
}
