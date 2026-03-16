// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { collectFiles, loadFileContents, findPackageJson, detectFramework } from '../utils/fs.js';
import { resetFindingCounter, mergeResults } from '../analyzers/base.js';
import { analyzeFeatureReality } from '../analyzers/feature-reality.js';
import { analyzeFrontendWiring } from '../analyzers/frontend-wiring.js';
import { analyzeBackendIntegrity } from '../analyzers/backend-integrity.js';
import { analyzeDataModel } from '../analyzers/data-model.js';
import { analyzeValidation } from '../analyzers/validation.js';
import { analyzeErrorHandling } from '../analyzers/error-handling.js';
import { analyzeSecurityAuth } from '../analyzers/security-auth.js';
import { analyzeMaintainability } from '../analyzers/maintainability.js';
import { analyzeTesting } from '../analyzers/testing.js';
import { analyzeDeployment } from '../analyzers/deployment.js';
import { analyzeSmells } from '../analyzers/smells.js';
import { analyzeSmellFingerprint } from '../analyzers/smell-fingerprint.js';
import { analyzeWiring } from '../analyzers/wiring.js';
import { analyzeCrossWiring } from '../analyzers/cross-wiring.js';
import { analyzeFrameworks } from '../analyzers/frameworks.js';
import { analyzeSpecReality } from '../analyzers/spec-reality.js';
import { analyzeIntegrationFlow } from '../analyzers/integration-flow.js';
import { analyzeHealthSurface } from '../analyzers/health-surface.js';
import { buildDepGraph, enrichFindingsWithDownstream } from './dep-graph.js';

export interface ScanResult extends AnalyzerResult {
  ctx: AnalyzerContext;
}

export async function scan(root: string): Promise<ScanResult> {
  resetFindingCounter();

  const files = await collectFiles(root);
  if (files.length === 0) {
    console.error('No source files found.');
    return { findings: [], smellHits: [], ctx: { root, files: [], fileContents: new Map(), framework: undefined } };
  }

  const fileContents = loadFileContents(root, files);
  const packageJson = findPackageJson(root) ?? undefined;
  const framework = detectFramework(packageJson ?? null);

  const ctx: AnalyzerContext = {
    root,
    files,
    fileContents,
    packageJson,
    framework,
  };

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
    analyzeDeployment(ctx),
    analyzeSmells(ctx),
    analyzeSmellFingerprint(ctx),
    analyzeWiring(ctx),
    analyzeCrossWiring(ctx),
    analyzeFrameworks(ctx),
    analyzeSpecReality(ctx),
    analyzeIntegrationFlow(ctx),
    analyzeHealthSurface(ctx),
  ];

  const merged = mergeResults(...results);

  // Enrich critical/high findings with downstream impact info
  const graph = buildDepGraph(ctx);
  merged.findings = enrichFindingsWithDownstream(merged.findings, graph);

  return { ...merged, ctx };
}
