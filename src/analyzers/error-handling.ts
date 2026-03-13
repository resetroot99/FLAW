// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, makeSmell, emptyResult } from './base.js';
import { searchFiles, extractSnippet } from '../utils/patterns.js';
import { isTestFile } from '../utils/fs.js';

const srcFilter = (f: string) => !isTestFile(f) && /\.(ts|tsx|js|jsx|py|rb|go)$/.test(f);
const pyFilter = (f: string) => !isTestFile(f) && /\.py$/.test(f);
const jsFilter = (f: string) => !isTestFile(f) && /\.(ts|tsx|js|jsx)$/.test(f);

export function analyzeErrorHandling(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  // ── JS/TS: Empty catch blocks ──
  for (const [file, content] of ctx.fileContents) {
    if (!jsFilter(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Empty catch blocks
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line) || (
        /catch\s*\([^)]*\)\s*\{/.test(line) &&
        i + 1 < lines.length &&
        /^\s*\}/.test(lines[i + 1])
      )) {
        result.findings.push(makeFinding({
          ruleId: 'FK-EH-SILENT-001',
          title: 'Empty catch block swallows error silently',
          categoryId: 'EH',
          severity: 'high',
          confidence: 'high',
          labels: ['Silent Failure'],
          summary: `Empty catch at ${file}:${i + 1} silently swallows errors.`,
          impact: 'Failures go unnoticed, making debugging impossible.',
          location: { file, startLine: i + 1 },
          codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 2, 2),
          suggestedFix: 'Log the error or surface it appropriately.',
        }));
      }

      // Catch that only console.logs
      if (/catch\s*\(\w+\)\s*\{/.test(line)) {
        const catchBody = lines.slice(i + 1, Math.min(i + 4, lines.length)).join('\n');
        if (/^\s*console\.(log|warn)\(/.test(catchBody) && /^\s*\}/.test(lines[Math.min(i + 2, lines.length - 1)])) {
          result.findings.push(makeFinding({
            ruleId: 'FK-EH-SILENT-001',
            title: 'Catch block only logs to console',
            categoryId: 'EH',
            severity: 'medium',
            confidence: 'high',
            labels: ['Silent Failure', 'Fragile'],
            summary: `Catch at ${file}:${i + 1} logs but does not handle the error.`,
            impact: 'Users see no feedback; error only visible in dev console.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 1, 3),
            suggestedFix: 'Surface error to user or upstream handler.',
          }));
        }
      }
    }
  }

  // ── Python: except: pass / except Exception: pass ──
  for (const [file, content] of ctx.fileContents) {
    if (!pyFilter(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // except ...: pass (or except ...: followed by just pass on next line)
      if (/^except\b/.test(line)) {
        const exceptLine = line;
        // Check if it's a bare except or broad Exception
        const isBroadCatch = /^except\s*:|^except\s+Exception\b|^except\s+BaseException\b/.test(exceptLine);
        // Check body: next few lines
        const bodyLines: string[] = [];
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const bl = lines[j].trim();
          if (bl === '' || bl.startsWith('#')) continue;
          if (/^(except|else|finally|def |class |@|if |for |while |return |raise )/.test(bl)) break;
          bodyLines.push(bl);
        }
        const body = bodyLines.join('\n');

        // except: pass
        if (/:\s*pass\s*$/.test(exceptLine) || (bodyLines.length === 1 && bodyLines[0] === 'pass')) {
          result.findings.push(makeFinding({
            ruleId: 'FK-EH-SILENT-002',
            title: isBroadCatch ? 'Broad except swallows all errors with pass' : 'Exception swallowed with pass',
            categoryId: 'EH',
            severity: isBroadCatch ? 'high' : 'medium',
            confidence: 'high',
            labels: ['Silent Failure'],
            summary: `${file}:${i + 1} catches ${isBroadCatch ? 'all exceptions' : 'an exception'} and does nothing.`,
            impact: 'Errors vanish silently. Bugs become impossible to trace.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 3, 2),
            suggestedFix: 'Log the exception or let it propagate. Never use except: pass.',
          }));
          result.smellHits.push(makeSmell('SMELL-EXCEPTION-SWALLOW', 'Exception swallowed', 1));
        }

        // except Exception: return None/[]/{}
        else if (isBroadCatch && /^return\s+(None|\[\]|\{\}|""|\b0\b|False)\s*$/.test(body)) {
          result.findings.push(makeFinding({
            ruleId: 'FK-EH-SILENT-002',
            title: 'Broad except returns default value — errors masked',
            categoryId: 'EH',
            severity: 'high',
            confidence: 'high',
            labels: ['Silent Failure', 'Misleading'],
            summary: `${file}:${i + 1} catches all exceptions and returns a default instead of surfacing the error.`,
            impact: 'Caller gets empty data with no indication something failed.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 3, 3),
            suggestedFix: 'Log the exception. Return an error response or let it propagate.',
          }));
          result.smellHits.push(makeSmell('SMELL-EXCEPTION-SWALLOW', 'Exception swallowed', 1));
        }

        // except Exception as e: (only logs, doesn't re-raise or return error)
        else if (isBroadCatch && bodyLines.length <= 2) {
          const onlyLogs = bodyLines.every(l => /^(logger\.|logging\.|print\(|pass$)/.test(l));
          if (onlyLogs && bodyLines.length > 0 && bodyLines[0] !== 'pass') {
            result.findings.push(makeFinding({
              ruleId: 'FK-EH-SILENT-002',
              title: 'Broad except only logs — error not surfaced to caller',
              categoryId: 'EH',
              severity: 'medium',
              confidence: 'medium',
              labels: ['Silent Failure', 'Fragile'],
              summary: `${file}:${i + 1} catches all exceptions, logs, but doesn't re-raise or return an error.`,
              impact: 'Caller has no idea the operation failed.',
              location: { file, startLine: i + 1 },
              codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 3, 3),
              suggestedFix: 'Re-raise the exception or return a proper error response.',
            }));
          }
        }
      }
    }
  }

  // ── Python: Stub functions (pass, NotImplementedError, ...) ──
  for (const [file, content] of ctx.fileContents) {
    if (!pyFilter(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match function/method definitions
      if (!/^\s*(async\s+)?def\s+\w+/.test(line)) continue;
      const funcName = line.match(/def\s+(\w+)/)?.[1] || '';
      // Skip dunder methods, test functions, and lifecycle/cleanup methods
      if (/^(__\w+__|test_|_test$)/.test(funcName)) continue;
      if (/^(close|teardown|dispose|shutdown|cleanup|disconnect|destroy|on_shutdown|on_close)$/i.test(funcName)) continue;

      // Check body: next 5 non-blank, non-comment lines
      const bodyLines: string[] = [];
      let docstringOpen = false;
      for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
        const bl = lines[j].trim();
        if (bl.startsWith('"""') || bl.startsWith("'''")) {
          docstringOpen = !docstringOpen;
          if (bl.match(/^(['"])\1\1.*\1\1\1$/)) docstringOpen = false; // single-line docstring
          continue;
        }
        if (docstringOpen) continue;
        if (bl === '' || bl.startsWith('#')) continue;
        if (/^(def |class |@)/.test(bl)) break;
        bodyLines.push(bl);
        if (bodyLines.length >= 3) break;
      }

      if (bodyLines.length === 0) continue;

      // Function body is just: pass
      if (bodyLines.length === 1 && bodyLines[0] === 'pass') {
        result.findings.push(makeFinding({
          ruleId: 'FK-FR-STUB-001',
          title: `Function "${funcName}" is a stub (pass)`,
          categoryId: 'FR',
          severity: 'high',
          confidence: 'high',
          labels: ['Incomplete', 'Fake Flow'],
          summary: `${file}:${i + 1} defines "${funcName}" but the body is just "pass".`,
          impact: 'Calling this function does nothing. Feature is not implemented.',
          location: { file, startLine: i + 1 },
          codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 0, 4),
          suggestedFix: `Implement "${funcName}" or remove it if unused.`,
        }));
      }

      // Function body is just: raise NotImplementedError
      if (bodyLines.length === 1 && /raise\s+NotImplementedError/.test(bodyLines[0])) {
        result.findings.push(makeFinding({
          ruleId: 'FK-FR-STUB-001',
          title: `Function "${funcName}" raises NotImplementedError`,
          categoryId: 'FR',
          severity: 'high',
          confidence: 'high',
          labels: ['Incomplete', 'Fake Flow'],
          summary: `${file}:${i + 1} defines "${funcName}" but it only raises NotImplementedError.`,
          impact: 'Any caller will get an exception at runtime.',
          location: { file, startLine: i + 1 },
          codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 0, 4),
          suggestedFix: `Implement "${funcName}" or remove it.`,
        }));
      }

      // Function body is just: return None / return [] / return {}
      if (bodyLines.length === 1 && /^return\s+(None|\[\]|\{\})$/.test(bodyLines[0])) {
        // Only flag if the function name suggests it should return real data
        if (/^(get_|fetch_|load_|find_|search_|list_|retrieve_|compute_|calculate_|generate_|build_|create_)/.test(funcName)) {
          result.findings.push(makeFinding({
            ruleId: 'FK-FR-STUB-001',
            title: `Function "${funcName}" always returns empty/None`,
            categoryId: 'FR',
            severity: 'medium',
            confidence: 'medium',
            labels: ['Incomplete', 'Fake Flow'],
            summary: `${file}:${i + 1} defines "${funcName}" but always returns ${bodyLines[0].replace('return ', '')}.`,
            impact: 'Callers receive empty data — feature appears broken.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 0, 4),
            suggestedFix: `Implement real logic in "${funcName}" or remove it.`,
          }));
        }
      }
    }
  }

  // ── Python: Route handlers with unused Depends() parameters ──
  for (const [file, content] of ctx.fileContents) {
    if (!pyFilter(file) || !/\b(api|route|endpoint|views)\b/i.test(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*(async\s+)?def\s+\w+/.test(lines[i])) continue;
      const funcName = lines[i].match(/def\s+(\w+)/)?.[1] || '';

      // Collect parameter names that use Depends()
      const paramBlock: string[] = [];
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        paramBlock.push(lines[j]);
        if (lines[j].includes('):') || lines[j].trim().endsWith('):') || (j > i && /^\s*\)\s*(->\s*.+)?:\s*$/.test(lines[j]))) break;
      }
      const paramText = paramBlock.join('\n');
      const dependsParams: string[] = [];
      const dependsRegex = /(\w+)\s*(?::\s*\w+\s*)?=\s*Depends\(/g;
      let match;
      while ((match = dependsRegex.exec(paramText)) !== null) {
        dependsParams.push(match[1]);
      }

      if (dependsParams.length === 0) continue;

      // Get function body
      const bodyEnd = Math.min(i + 60, lines.length);
      const body = lines.slice(i + paramBlock.length, bodyEnd).join('\n');

      for (const param of dependsParams) {
        // Skip common auth/session params that are used implicitly
        if (/^(current_user|user|session|db|tenant|auth)$/i.test(param)) continue;
        // Skip underscore-prefixed params — convention for intentionally unused (e.g., auth guards)
        if (/^_/.test(param)) continue;
        const usageRegex = new RegExp(`\\b${param}\\b`);
        if (!usageRegex.test(body)) {
          result.findings.push(makeFinding({
            ruleId: 'FK-BE-UNUSED-001',
            title: `Route param "${param}" injected via Depends() but never used`,
            categoryId: 'BE',
            severity: 'medium',
            confidence: 'high',
            labels: ['Dead Control', 'Incomplete'],
            summary: `${file}:${i + 1} injects "${param}" via Depends() but the function body never references it.`,
            impact: 'Unnecessary dependency injection. May indicate incomplete implementation.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 0, 6),
            suggestedFix: `Use "${param}" in the handler or remove the dependency.`,
          }));
        }
      }
    }
  }

  // ── Fallback values (JS/TS) ──
  const fallbackHits = searchFiles(
    ctx.fileContents,
    /\?\?\s*['"`](?:N\/A|Unknown|Default|None|—|-)['"`]|\?\?\s*\[\s*\]|\|\|\s*['"`](?:N\/A|Unknown)['"`]/,
    srcFilter,
  );
  if (fallbackHits.length > 3) {
    result.findings.push(makeFinding({
      ruleId: 'FK-EH-FALLBACK-001',
      title: 'Excessive fallback values may mask broken data flow',
      categoryId: 'EH',
      severity: 'medium',
      confidence: 'medium',
      labels: ['Fragile', 'Misleading'],
      summary: `${fallbackHits.length} suspicious fallback patterns found across codebase.`,
      impact: 'Fallbacks may hide broken data sources or missing fields.',
      location: { file: fallbackHits[0].file, startLine: fallbackHits[0].line },
      codeSnippet: extractSnippet(ctx.fileContents, fallbackHits[0].file, fallbackHits[0].line),
      evidenceRefs: fallbackHits.slice(0, 5).map(h => `${h.file}:${h.line} — ${h.context.slice(0, 60)}`),
      suggestedFix: 'Verify data sources. Fallbacks should be intentional, not defensive.',
    }));
  }

  // ── .catch() followed by success state (JS/TS) ──
  const catchSuccessHits = searchFiles(
    ctx.fileContents,
    /\.catch\(\s*(?:\(\w*\)\s*=>|function)\s*\{[^}]*(?:setSuccess|setLoading\(false\))/,
    srcFilter,
  );
  for (const hit of catchSuccessHits) {
    result.findings.push(makeFinding({
      ruleId: 'FK-EH-FALSESUCCESS-001',
      title: 'Catch handler may set success state',
      categoryId: 'EH',
      severity: 'critical',
      confidence: 'medium',
      labels: ['Misleading', 'Fake Flow', 'Production-Blocking'],
      summary: `Error catch at ${hit.file}:${hit.line} appears to set a success-like state.`,
      impact: 'Users see success after an error.',
      location: { file: hit.file, startLine: hit.line },
      codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line, 2, 4),
      suggestedFix: 'Ensure catch handlers set error state, not success.',
    }));
  }

  return result;
}
