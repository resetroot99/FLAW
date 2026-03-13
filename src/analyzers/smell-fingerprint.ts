// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
import type { AnalyzerContext, AnalyzerResult, FingerprintHit } from '../types/index.js';
import { makeSmell, emptyResult } from './base.js';
import { isSourceFile, isTestFile } from '../utils/fs.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Signature types matching rulepacks/smell-signatures.json
interface SignaturePattern {
  id: string;
  description: string;
  regex?: string;
  fileTypes?: string[];
  filePattern?: string;
  crossCheck?: string;
  weight: number;
  evidence: string;
}

interface ToolSignature {
  name: string;
  patterns: SignaturePattern[];
}

interface SignatureDatabase {
  version: string;
  updated: string;
  signatures: Record<string, ToolSignature>;
}

function loadSignatures(): SignatureDatabase {
  // Resolve from the module location up to project root
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(thisDir, '..', '..');
  const sigPath = join(projectRoot, 'rulepacks', 'smell-signatures.json');
  return JSON.parse(readFileSync(sigPath, 'utf-8'));
}

function getFileExtension(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot >= 0 ? file.slice(dot + 1) : '';
}

/**
 * Cross-check: hook name imported but not called in file body.
 * Returns true if the file imports a React hook but never calls it.
 */
function crossCheckUnusedHook(content: string): boolean {
  const importMatch = content.match(/import\s*\{([^}]+)\}\s*from\s*['"]react['"]/);
  if (!importMatch) return false;
  const imported = importMatch[1].split(',').map(s => s.trim()).filter(s => /^use[A-Z]/.test(s));
  if (imported.length === 0) return false;

  // Get the file body after the import block
  const lines = content.split('\n');
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^import\s/.test(lines[i].trim())) bodyStart = i + 1;
  }
  const body = lines.slice(bodyStart).join('\n');

  for (const hook of imported) {
    // Check if the hook is called (hookName( or hookName<) in the body
    const callPattern = new RegExp(`\\b${hook}\\s*[(<]`);
    if (!callPattern.test(body)) return true;
  }
  return false;
}

/**
 * Cross-check: test file has no error/failure/reject/throw test cases.
 * Returns true if the file is a test file with only happy-path tests.
 */
function crossCheckHappyPathOnly(file: string, content: string): boolean {
  if (!isTestFile(file)) return false;
  // Must have at least one test
  if (!/\b(it|test|describe)\s*\(/.test(content)) return false;
  // Check for negative test patterns
  const negativePatterns = /\b(error|fail|reject|throw|invalid|unauthorized|forbidden|not found|400|401|403|404|500|should not|should fail|should throw|should reject|toThrow|rejects)\b/i;
  return !negativePatterns.test(content);
}

/**
 * Cross-check: import count > 8 and some imported names not found in file body.
 * Returns true if file over-imports.
 */
function crossCheckOverImport(content: string): boolean {
  const importLines = content.split('\n').filter(line => /^\s*import\s/.test(line));
  if (importLines.length <= 8) return false;

  // Extract named imports
  const allImported: string[] = [];
  for (const line of importLines) {
    const namedMatch = line.match(/\{([^}]+)\}/);
    if (namedMatch) {
      const names = namedMatch[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean);
      allImported.push(...names);
    }
  }
  if (allImported.length === 0) return false;

  // Get file body after imports
  const lines = content.split('\n');
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s/.test(lines[i])) bodyStart = i + 1;
  }
  const body = lines.slice(bodyStart).join('\n');

  let unusedCount = 0;
  for (const name of allImported) {
    if (name.length < 2) continue; // Skip single-char names
    const usagePattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (!usagePattern.test(body)) unusedCount++;
  }
  return unusedCount > 0;
}

/**
 * Cross-check: imported file doesn't exist in the project.
 * Returns number of phantom imports found.
 */
function crossCheckPhantomImport(file: string, content: string, allFiles: string[]): number {
  const importRegex = /import\s+.*from\s+['"](\.\.\/?|\.\/)([^'"]+)['"]/g;
  let phantomCount = 0;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(content)) !== null) {
    const relativePart = match[1] + match[2];
    // Only check utility/helper/lib imports
    if (!/utils\/|helpers\/|lib\//.test(relativePart)) continue;

    const dir = file.split('/').slice(0, -1).join('/');
    const resolved = dir ? `${dir}/${relativePart}`.replace(/\/\.\//g, '/') : relativePart.replace(/^\.\//, '');
    const normalized = resolved.replace(/\/+/g, '/');
    const base = normalized.replace(/\.(js|jsx|ts|tsx)$/, '');

    const exists = allFiles.some(f => {
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
    if (!exists) phantomCount++;
  }
  return phantomCount;
}

/**
 * Cross-check: jwt.decode without jwt.verify in same file.
 * Returns true if file uses jwt.decode but not jwt.verify.
 */
function crossCheckSkipVerify(content: string): boolean {
  const hasDecode = /jwt\.decode/.test(content);
  const hasVerify = /jwt\.verify/.test(content);
  return hasDecode && !hasVerify;
}

/**
 * Cross-check: file has more import/export lines than logic lines.
 * Returns true if file is a facade with thin implementation.
 */
function crossCheckCompleteFacade(content: string): boolean {
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 5) return false;

  let importExportLines = 0;
  let logicLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(import|export)\s/.test(trimmed) || /^(import|export)\{/.test(trimmed) || /^\}.*from\s/.test(trimmed)) {
      importExportLines++;
    } else if (
      trimmed.length > 0 &&
      !trimmed.startsWith('//') &&
      !trimmed.startsWith('/*') &&
      !trimmed.startsWith('*') &&
      trimmed !== '{' &&
      trimmed !== '}' &&
      trimmed !== ');'
    ) {
      logicLines++;
    }
  }
  return importExportLines > 3 && importExportLines > logicLines;
}

export function analyzeSmellFingerprint(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();
  const db = loadSignatures();

  // Track hits per tool: toolKey -> { patternId -> count }
  const toolHits = new Map<string, Map<string, number>>();
  // Track total weighted score per tool
  const toolWeightedScores = new Map<string, number>();
  // Track max possible weighted score per tool
  const toolMaxScores = new Map<string, number>();

  const srcFilter = (f: string) => isSourceFile(f) && !isTestFile(f);

  for (const [toolKey, toolSig] of Object.entries(db.signatures)) {
    const patternHits = new Map<string, number>();
    let weightedScore = 0;
    let maxScore = 0;

    for (const pattern of toolSig.patterns) {
      maxScore += pattern.weight;
      let hitCount = 0;

      // If pattern has only a crossCheck (no regex), handle specially
      if (!pattern.regex && pattern.crossCheck) {
        hitCount = runCrossCheckOnly(pattern, ctx, srcFilter);
      } else if (pattern.regex) {
        // Build regex from pattern
        let regex: RegExp;
        try {
          regex = new RegExp(pattern.regex, 'i');
        } catch {
          continue;
        }

        // Determine file filter
        let fileFilter: (f: string) => boolean;
        if (pattern.fileTypes && pattern.fileTypes.length > 0) {
          const exts = new Set(pattern.fileTypes);
          fileFilter = (f: string) => srcFilter(f) && exts.has(getFileExtension(f));
        } else if (pattern.filePattern) {
          const fpRegex = new RegExp(pattern.filePattern);
          fileFilter = (f: string) => srcFilter(f) && fpRegex.test(f);
        } else {
          fileFilter = srcFilter;
        }

        // Scan files
        for (const [file, content] of ctx.fileContents) {
          if (!fileFilter(file)) continue;

          if (regex.test(content)) {
            // If there's a crossCheck, validate it
            if (pattern.crossCheck) {
              if (passesCrossCheck(pattern, file, content, ctx)) {
                hitCount++;
              }
            } else {
              // Count occurrences within the file
              const globalRegex = new RegExp(pattern.regex, 'gi');
              const matches = content.match(globalRegex);
              hitCount += matches ? matches.length : 1;
            }
          }
        }
      }

      if (hitCount > 0) {
        patternHits.set(pattern.id, hitCount);
        weightedScore += pattern.weight;

        // Add individual pattern smell hit
        result.smellHits.push(makeSmell(
          pattern.id,
          `${toolSig.name}: ${pattern.description}`,
          hitCount,
        ));
      }
    }

    toolHits.set(toolKey, patternHits);
    toolWeightedScores.set(toolKey, weightedScore);
    toolMaxScores.set(toolKey, maxScore);

    // Add aggregate tool smell hit if any patterns matched
    const totalHits = Array.from(patternHits.values()).reduce((sum, n) => sum + n, 0);
    if (totalHits > 0) {
      const smellId = `SMELL-${toolKey.toUpperCase()}` as string;
      result.smellHits.push(makeSmell(
        smellId,
        `${toolSig.name} fingerprint detected`,
        totalHits,
      ));
    }
  }

  return result;
}

/**
 * Run cross-check logic for patterns that have no regex (cross-check only).
 */
function runCrossCheckOnly(
  pattern: SignaturePattern,
  ctx: AnalyzerContext,
  srcFilter: (f: string) => boolean,
): number {
  let hitCount = 0;
  const check = pattern.crossCheck || '';

  if (check.includes('import count > 8')) {
    // COPILOT-OVER-IMPORT-001
    for (const [file, content] of ctx.fileContents) {
      if (!srcFilter(file)) continue;
      if (crossCheckOverImport(content)) hitCount++;
    }
  } else if (check.includes('test file has no error')) {
    // COPILOT-HAPPY-PATH-001
    for (const [file, content] of ctx.fileContents) {
      if (crossCheckHappyPathOnly(file, content)) hitCount++;
    }
  } else if (check.includes('more import/export lines than logic')) {
    // CLAUDE-COMPLETE-FACADE-001
    for (const [file, content] of ctx.fileContents) {
      if (!srcFilter(file)) continue;
      if (crossCheckCompleteFacade(content)) hitCount++;
    }
  }

  return hitCount;
}

/**
 * Run cross-check validation for patterns that matched the regex.
 * Returns true if the cross-check confirms the pattern is a real hit.
 */
function passesCrossCheck(
  pattern: SignaturePattern,
  file: string,
  content: string,
  ctx: AnalyzerContext,
): boolean {
  const check = pattern.crossCheck || '';

  if (check.includes('hook name imported but not called')) {
    return crossCheckUnusedHook(content);
  }

  if (check.includes('imported file doesn\'t exist') || check.includes("imported file doesn't exist")) {
    return crossCheckPhantomImport(file, content, ctx.files) > 0;
  }

  if (check.includes('jwt.decode without jwt.verify')) {
    return crossCheckSkipVerify(content);
  }

  if (check.includes('test file has no error')) {
    return crossCheckHappyPathOnly(file, content);
  }

  if (check.includes('import count > 8')) {
    return crossCheckOverImport(content);
  }

  if (check.includes('more import/export lines than logic')) {
    return crossCheckCompleteFacade(content);
  }

  // Unknown cross-check — treat regex match as sufficient
  return true;
}

/**
 * Compute fingerprint results from smell hits.
 * Called externally by scorer to build the fingerprint summary.
 */
export function computeFingerprints(smellHits: SmellHitLike[]): FingerprintHit[] {
  // Load signatures to get tool names and max weights
  const db = loadSignatures();
  const results: FingerprintHit[] = [];

  for (const [toolKey, toolSig] of Object.entries(db.signatures)) {
    const smellId = `SMELL-${toolKey.toUpperCase()}`;
    const toolSmell = smellHits.find(s => s.id === smellId);
    if (!toolSmell || toolSmell.count === 0) continue;

    // Count how many individual patterns from this tool matched
    let matchedPatternWeight = 0;
    let totalWeight = 0;
    for (const pattern of toolSig.patterns) {
      totalWeight += pattern.weight;
      const patternSmell = smellHits.find(s => s.id === pattern.id);
      if (patternSmell && patternSmell.count > 0) {
        matchedPatternWeight += pattern.weight;
      }
    }

    if (totalWeight === 0) continue;
    const confidence = Math.round((matchedPatternWeight / totalWeight) * 100);

    results.push({
      tool: toolSig.name,
      confidence,
      hits: toolSmell.count,
    });
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

// Minimal type for smell hits accepted by computeFingerprints
interface SmellHitLike {
  id: string;
  count: number;
}
