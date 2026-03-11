import type { AnalyzerContext, AnalyzerResult, SmellHit } from '../types/index.js';
import { makeSmell, emptyResult } from './base.js';
import { searchFiles, filesMatching, countPattern } from '../utils/patterns.js';
import { isTestFile, isSourceFile } from '../utils/fs.js';

const srcFilter = (f: string) => isSourceFile(f) && !isTestFile(f);

export function analyzeSmells(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  // SMELL-HALLUCINATED-REF: Unresolved imports
  const unresolvedImports = searchFiles(
    ctx.fileContents,
    /import\s+.*from\s+['"`]\.\.?\/[^'"`]+['"`]/,
    srcFilter,
  );
  // Check if imported file exists
  let hallucinated = 0;
  for (const hit of unresolvedImports) {
    const importMatch = hit.match.match(/from\s+['"`](\.\.?\/[^'"`]+)['"`]/);
    if (!importMatch) continue;
    const importPath = importMatch[1];
    const dir = hit.file.split('/').slice(0, -1).join('/');
    const resolved = dir ? `${dir}/${importPath}`.replace(/\/\.\//g, '/') : importPath.replace(/^\.\//, '');
    const normalized = resolved.replace(/\/+/g, '/');

    // Check various extensions, including .js -> .ts resolution (TypeScript ESM convention)
    const base = normalized.replace(/\.(js|jsx|ts|tsx)$/, '');
    const exists = ctx.files.some(f => {
      const fBase = f.replace(/\.(js|jsx|ts|tsx)$/, '');
      return f === normalized ||
        fBase === base ||
        fBase === normalized ||
        f === `${normalized}.ts` ||
        f === `${normalized}.tsx` ||
        f === `${normalized}.js` ||
        f === `${normalized}.jsx` ||
        f === `${normalized}/index.ts` ||
        f === `${normalized}/index.tsx` ||
        f === `${normalized}/index.js` ||
        f === `${base}.ts` ||
        f === `${base}.tsx`;
    });
    if (!exists) hallucinated++;
  }
  if (hallucinated > 0) {
    result.smellHits.push(makeSmell('SMELL-HALLUCINATED-REF', 'Hallucinated reference', hallucinated));
  }

  // SMELL-OVERPROMPTED-INCONSISTENCY: Mixed patterns
  // Check for multiple state management approaches
  const stateApproaches: string[] = [];
  const statePatterns: [string, RegExp][] = [
    ['useState', /\buseState\b/],
    ['useReducer', /\buseReducer\b/],
    ['zustand', /\buseStore\b.*zustand|import.*zustand/],
    ['redux', /\buseSelector\b|\buseDispatch\b|import.*redux/],
    ['jotai', /\buseAtom\b|import.*jotai/],
    ['recoil', /\buseRecoilState\b|import.*recoil/],
    ['mobx', /\bobserver\b.*mobx|import.*mobx/],
    ['valtio', /\buseSnapshot\b|import.*valtio/],
  ];
  for (const [name, pattern] of statePatterns) {
    if (filesMatching(ctx.fileContents, pattern, srcFilter).length > 0) {
      stateApproaches.push(name);
    }
  }
  // Multiple global state libs (useState doesn't count) is a smell
  const globalStateLibs = stateApproaches.filter(s => s !== 'useState' && s !== 'useReducer');
  if (globalStateLibs.length > 1) {
    result.smellHits.push(makeSmell('SMELL-OVERPROMPTED-INCONSISTENCY', 'Over-prompted inconsistency', globalStateLibs.length));
  }

  // SMELL-DOCS-OVERSTATE-CAPABILITY: README mentions features
  const readmeFile = ctx.files.find(f => /^readme\.(md|txt)$/i.test(f));
  if (readmeFile) {
    const content = ctx.fileContents.get(readmeFile);
    if (content) {
      const featureClaims = (content.match(/[✅✓⚡🚀]\s*\w+|[-*]\s+\w.*(?:integration|automation|real-time|AI-powered|analytics|dashboard)/gi) || []).length;
      if (featureClaims > 10) {
        result.smellHits.push(makeSmell('SMELL-DOCS-OVERSTATE-CAPABILITY', 'Docs overstate capability', 1));
      }
    }
  }

  // SMELL-FAKE-INTEGRATION-ADAPTER: Stub services (JS + Python)
  const stubIndicators = searchFiles(
    ctx.fileContents,
    /(?:\/\/|#)\s*(?:stub|mock|fake|todo|placeholder)|return\s+(?:Promise\.resolve|null|undefined|\[\]|\{\})\s*;?\s*(?:\/\/|#).*(?:implement|real|actual|todo)/i,
    srcFilter,
  );
  // Python: pass-only functions, NotImplementedError
  const pyStubs = searchFiles(
    ctx.fileContents,
    /raise\s+NotImplementedError|^\s+pass\s*$/,
    (f) => srcFilter(f) && /\.py$/.test(f),
  );
  const totalStubs = stubIndicators.length + Math.floor(pyStubs.length / 2); // pass lines are common, so weight lower
  if (totalStubs > 0) {
    result.smellHits.push(makeSmell('SMELL-FAKE-INTEGRATION-ADAPTER', 'Fake integration adapter', totalStubs));
  }

  return result;
}
