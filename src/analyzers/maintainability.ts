import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, makeSmell, emptyResult } from './base.js';
import { searchFiles, countPattern, filesMatching, extractSnippet } from '../utils/patterns.js';
import { isTestFile, isSourceFile } from '../utils/fs.js';

const srcFilter = (f: string) => isSourceFile(f) && !isTestFile(f);

export function analyzeMaintainability(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  // FK-MH-SIZE-001: Giant files
  for (const [file, content] of ctx.fileContents) {
    if (!srcFilter(file)) continue;
    const lineCount = content.split('\n').length;
    if (lineCount > 500) {
      result.findings.push(makeFinding({
        ruleId: 'FK-MH-SIZE-001',
        title: `File has ${lineCount} lines`,
        categoryId: 'MH',
        severity: lineCount > 1000 ? 'high' : 'medium',
        confidence: 'high',
        labels: ['Fragile'],
        summary: `${file} is ${lineCount} lines — hard to navigate and maintain.`,
        impact: 'Large files increase cognitive load and merge conflict risk.',
        location: { file },
        suggestedFix: 'Break into smaller, focused modules.',
      }));
    }
  }

  // FK-MH-DEADCODE-001: Commented-out code blocks
  const commentedCode = searchFiles(
    ctx.fileContents,
    /\/\/\s*(const|let|var|function|class|import|export|return|if|for|while|switch|async)\s/,
    srcFilter,
  );
  if (commentedCode.length > 10) {
    result.findings.push(makeFinding({
      ruleId: 'FK-MH-DEADCODE-001',
      title: 'Excessive commented-out code',
      categoryId: 'MH',
      severity: 'medium',
      confidence: 'high',
      labels: ['Fragile'],
      summary: `${commentedCode.length} lines of commented-out code found.`,
      impact: 'Dead code confuses maintainers and hides intent.',
      location: { file: commentedCode[0].file, startLine: commentedCode[0].line },
      codeSnippet: extractSnippet(ctx.fileContents, commentedCode[0].file, commentedCode[0].line),
      evidenceRefs: commentedCode.slice(0, 5).map(h => `${h.file}:${h.line} — ${h.context.slice(0, 60)}`),
      suggestedFix: 'Remove dead code. Use version control for history.',
    }));
    result.smellHits.push(makeSmell('SMELL-COMMENTED-REAL-LOGIC', 'Commented-out real logic', commentedCode.length));
  }

  // FK-MH-DUPLICATION-001: Similar function names suggesting duplication
  const funcDefs = searchFiles(
    ctx.fileContents,
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/,
    srcFilter,
  );
  const funcNames = funcDefs.map(d => {
    const m = d.match.match(/function\s+(\w+)|const\s+(\w+)/);
    return m?.[1] || m?.[2] || '';
  }).filter(Boolean);

  // Find near-duplicate function names
  const nameGroups = new Map<string, string[]>();
  for (const name of funcNames) {
    const normalized = name.toLowerCase().replace(/\d+$/, '');
    const group = nameGroups.get(normalized) || [];
    group.push(name);
    nameGroups.set(normalized, group);
  }
  const duplicateGroups = Array.from(nameGroups.entries()).filter(([, names]) => names.length > 2);
  if (duplicateGroups.length > 0) {
    result.findings.push(makeFinding({
      ruleId: 'FK-MH-DUPLICATION-001',
      title: 'Possible duplicated logic detected',
      categoryId: 'MH',
      severity: 'medium',
      confidence: 'low',
      labels: ['Fragile'],
      summary: `${duplicateGroups.length} function name groups suggest duplicated logic.`,
      impact: 'Duplicated logic drifts and creates inconsistencies.',
      location: { file: funcDefs[0]?.file || 'unknown' },
      suggestedFix: 'Extract shared logic into a single source of truth.',
    }));
    result.smellHits.push(makeSmell('SMELL-DUPLICATE-GENERATION', 'Duplicate generated logic', duplicateGroups.length));
  }

  // FK-MH-ABSTRACTION-001: Wrapper files with minimal logic
  const thinWrappers = filesMatching(
    ctx.fileContents,
    /^(?:export\s+\{[^}]+\}\s+from|export\s+\*\s+from|export\s+default\s+\w+)/m,
    (f) => srcFilter(f) && !f.includes('index.'),
  );
  // Filter to files where >60% of lines are re-exports
  for (const file of thinWrappers) {
    const content = ctx.fileContents.get(file)!;
    const lines = content.split('\n').filter(l => l.trim());
    const exportLines = lines.filter(l => /^export\s/.test(l.trim()));
    if (lines.length < 20 && exportLines.length > lines.length * 0.6) {
      // This is probably fine for barrel files, skip unless it's not index
      if (!file.endsWith('index.ts') && !file.endsWith('index.js')) {
        result.smellHits.push(makeSmell('SMELL-CARGO-CULT-ABSTRACTION', 'Cargo-cult abstraction', 1));
      }
    }
  }

  return result;
}
