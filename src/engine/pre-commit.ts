import { resolve, extname, relative, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { resetFindingCounter, mergeResults } from '../analyzers/base.js';
import { readFileSafe, findPackageJson, detectFramework } from '../utils/fs.js';
import { analyzeFeatureReality } from '../analyzers/feature-reality.js';
import { analyzeFrontendWiring } from '../analyzers/frontend-wiring.js';
import { analyzeBackendIntegrity } from '../analyzers/backend-integrity.js';
import { analyzeDataModel } from '../analyzers/data-model.js';
import { analyzeValidation } from '../analyzers/validation.js';
import { analyzeErrorHandling } from '../analyzers/error-handling.js';
import { analyzeSecurityAuth } from '../analyzers/security-auth.js';
import { analyzeMaintainability } from '../analyzers/maintainability.js';
import { analyzeTesting } from '../analyzers/testing.js';
import { analyzeSmells } from '../analyzers/smells.js';
import { computeCategoryScores, computeSummary, computeSmellIndex, computeGates } from './scorer.js';
import type { AnalyzerContext, Finding } from '../types/index.js';

const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.astro',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.php', '.cs', '.swift',
]);

export interface PreCommitResult {
  score: number;
  findings: Finding[];
  criticalCount: number;
  status: 'pass' | 'fail';
}

/**
 * Run a fast, targeted scan on only the provided file paths.
 * Skips heavy operations (dep graph, triage, HTML) for speed.
 */
export function runPreCommit(root: string, filePaths: string[]): PreCommitResult {
  // Normalize paths to be relative to root
  const relFiles = filePaths
    .map(f => isAbsolute(f) ? relative(root, f) : f)
    .filter(f => {
      const ext = extname(f);
      return SUPPORTED_EXTENSIONS.has(ext);
    })
    .filter(f => existsSync(resolve(root, f)));

  // No supported files — nothing to check
  if (relFiles.length === 0) {
    return { score: 100, findings: [], criticalCount: 0, status: 'pass' };
  }

  resetFindingCounter();

  // Load only the changed files
  const fileContents = new Map<string, string>();
  for (const file of relFiles) {
    const content = readFileSafe(root, file);
    if (content !== null) {
      fileContents.set(file, content);
    }
  }

  const packageJson = findPackageJson(root) ?? undefined;
  const framework = detectFramework(packageJson ?? null);

  const ctx: AnalyzerContext = {
    root,
    files: relFiles,
    fileContents,
    packageJson,
    framework,
  };

  // Run analyzers (skip deployment and wiring — they need full project context)
  const results = [
    analyzeFeatureReality(ctx),
    analyzeFrontendWiring(ctx),
    analyzeBackendIntegrity(ctx),
    analyzeDataModel(ctx),
    analyzeValidation(ctx),
    analyzeErrorHandling(ctx),
    analyzeSecurityAuth(ctx),
    analyzeMaintainability(ctx),
    analyzeTesting(ctx),
    analyzeSmells(ctx),
  ];

  const merged = mergeResults(...results);
  const scores = computeCategoryScores(merged.findings);
  const smellIndex = computeSmellIndex(merged.smellHits);
  const gates = computeGates(merged.findings);
  const summary = computeSummary(scores, merged.findings, smellIndex, gates);

  const criticalCount = merged.findings.filter(f => f.severity === 'critical' && f.status === 'open').length;

  // Fail if score < 60 or any critical findings
  const status = (summary.totalScore < 60 || criticalCount > 0) ? 'fail' : 'pass';

  return {
    score: summary.totalScore,
    findings: merged.findings,
    criticalCount,
    status,
  };
}

/**
 * Format a compact one-line summary for pre-commit output.
 */
export function formatPreCommitLine(result: PreCommitResult): string {
  const issueCount = result.findings.filter(f => f.status === 'open').length;
  const criticalNote = result.criticalCount > 0 ? `, ${result.criticalCount} critical` : '';
  const statusLabel = result.status === 'pass' ? 'PASS' : 'FAIL';
  return `FLAW: ${result.score}/100 (${issueCount} issues${criticalNote}) — ${statusLabel}`;
}
