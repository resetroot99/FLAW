#!/usr/bin/env node

import { resolve, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { scan } from './engine/scanner.js';
import { computeCategoryScores, computeSmellIndex, computeGates, computeSummary } from './engine/scorer.js';
import { printReport, exportJson, exportMarkdown } from './engine/reporter.js';
import { exportHtml } from './engine/html-reporter.js';
import { loadIgnoreRules, applyIgnoreRules } from './engine/ignore.js';
import { computeTriage } from './engine/triage.js';
import { exportFixes } from './engine/fix-reporter.js';
import { generatePrompt, exportPrompt } from './engine/prompt-reporter.js';
import { startWatchMode } from './engine/watcher.js';
import { getGitBranch, getGitCommit, getGitRepoName } from './utils/git.js';
import { findPackageJson, detectFramework } from './utils/fs.js';
import { generateRoadmap, exportRoadmap } from './engine/roadmap.js';
import { exportAgentRules } from './engine/rules-generator.js';
import { analyzePromiseVsReality } from './engine/promise-reality.js';
import { generatePurposePlan, exportPurposePlan } from './engine/purpose-plan.js';
import { startRepl } from './engine/repl.js';
import type { AuditReport } from './types/index.js';

function printUsage(): void {
  console.log(`
  FLAW — Flow Logic Audit Watch

  Usage:
    flaw                            Launch interactive mode
    flaw [path]                     Scan and show report
    flaw [path] [options]           Scan with export options

  Interactive Mode:
    flaw                            REPL with /commands on current directory
    flaw ../my-app -i               REPL targeting a specific project

  Options:
    -i, --interactive  Launch interactive REPL
    --html         Export HTML report
    --json         Export JSON report
    --markdown     Export Markdown report
    --fixes        Export fix guide (flaw-fixes.md)
    --prompt       Export AI-ready prompt (flaw-prompt.md)
    --prompt-stdout  Print AI prompt to stdout only (for piping)
    --roadmap      Export production readiness roadmap (flaw-roadmap.md)
    --purpose      Export purpose alignment plan (flaw-purpose-plan.md)
    --rules        Export agent rules file (.cursorrules)
    --rules-md     Export agent rules as AGENT_RULES.md
    --watch        Watch mode — re-scan on file save
    --no-ignore    Skip .flaw-ignore processing
    --out <dir>    Output directory for exports (default: .)
    --quiet        Suppress terminal output
    --help         Show this help message

  Examples:
    flaw                            Interactive mode
    flaw .                          Audit current directory
    flaw ../my-app --html           Audit and export HTML report
    flaw . --fixes                  Generate fix guide
    flaw . --prompt-stdout | pbcopy Copy AI prompt to clipboard
    flaw . --watch                  Watch mode with live delta
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  // Parse args
  let targetPath = '.';
  let interactive = false;
  let exportJsonFlag = false;
  let exportMdFlag = false;
  let exportHtmlFlag = false;
  let exportFixesFlag = false;
  let exportPromptFlag = false;
  let promptStdout = false;
  let exportRoadmapFlag = false;
  let exportPurposeFlag = false;
  let exportRulesFlag = false;
  let rulesFormat: 'cursorrules' | 'claude' = 'cursorrules';
  let watchMode = false;
  let noIgnore = false;
  let outputDir = '.';
  let quiet = false;
  let hasFlags = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--interactive' || arg === '-i') { interactive = true; hasFlags = true; }
    else if (arg === '--json') { exportJsonFlag = true; hasFlags = true; }
    else if (arg === '--markdown' || arg === '--md') { exportMdFlag = true; hasFlags = true; }
    else if (arg === '--html') { exportHtmlFlag = true; hasFlags = true; }
    else if (arg === '--fixes') { exportFixesFlag = true; hasFlags = true; }
    else if (arg === '--prompt') { exportPromptFlag = true; hasFlags = true; }
    else if (arg === '--prompt-stdout') { promptStdout = true; hasFlags = true; }
    else if (arg === '--roadmap') { exportRoadmapFlag = true; hasFlags = true; }
    else if (arg === '--purpose') { exportPurposeFlag = true; hasFlags = true; }
    else if (arg === '--rules') { exportRulesFlag = true; hasFlags = true; }
    else if (arg === '--rules-md') { exportRulesFlag = true; rulesFormat = 'claude'; hasFlags = true; }
    else if (arg === '--watch') { watchMode = true; hasFlags = true; }
    else if (arg === '--no-ignore') { noIgnore = true; }
    else if (arg === '--out' && args[i + 1]) { outputDir = args[++i]; }
    else if (arg === '--quiet' || arg === '-q') { quiet = true; hasFlags = true; }
    else if (!arg.startsWith('-')) targetPath = arg;
  }

  const root = resolve(targetPath);
  if (!existsSync(root)) {
    console.error(`Path not found: ${root}`);
    process.exit(1);
  }

  // Interactive mode: bare `flaw`, `flaw -i`, or `flaw <path> -i`
  // Also: if stdin is a TTY and no flags were given, go interactive
  if (interactive || (args.length === 0 && process.stdin.isTTY)) {
    await startRepl(root, resolve(outputDir), noIgnore, true);
    return;
  }

  // Watch mode — enter and don't return
  if (watchMode) {
    await startWatchMode(root);
    return;
  }

  if (!quiet && !promptStdout) {
    console.log(`\n  Scanning ${root}...\n`);
  }

  const startTime = Date.now();
  const { findings: rawFindings, smellHits, ctx: scanCtx } = await scan(root);
  const durationMs = Date.now() - startTime;

  // Apply .flaw-ignore
  let findings = rawFindings;
  let suppressedCount = 0;
  if (!noIgnore) {
    const rules = loadIgnoreRules(root);
    const result = applyIgnoreRules(rawFindings, rules);
    findings = result.filtered;
    suppressedCount = result.suppressedCount;
  }

  const scores = computeCategoryScores(findings);
  const smellIndex = computeSmellIndex(smellHits);
  const gates = computeGates(findings);
  const summary = computeSummary(scores, findings, smellIndex, gates);
  const triage = computeTriage(findings, scores);

  const packageJson = findPackageJson(root);
  const pkgName = packageJson?.name as string | undefined;
  const gitRepoName = getGitRepoName(root);
  const genericNames = new Set(['root', 'project', 'app', 'monorepo', 'repo', 'workspace', 'source', 'undefined', 'client', 'server', 'frontend', 'backend', 'web', 'api', 'main', 'src']);
  const projectName = gitRepoName
    || (pkgName && !genericNames.has(pkgName.toLowerCase()) ? pkgName : null)
    || basename(resolve(root));
  const framework = detectFramework(packageJson);

  const report: AuditReport = {
    schemaVersion: '2.0.0',
    reportId: `audit_${Date.now()}`,
    generatedAt: new Date().toISOString(),
    project: {
      name: projectName,
      path: root,
      branch: getGitBranch(root),
      commitSha: getGitCommit(root),
      framework,
      packageManager: packageJson ? (existsSync(resolve(root, 'bun.lockb')) ? 'bun' : existsSync(resolve(root, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(resolve(root, 'yarn.lock')) ? 'yarn' : 'npm') : undefined,
    },
    audit: {
      type: 'launch-readiness',
      mode: 'static',
      durationMs,
    },
    summary,
    scores,
    smellIndex,
    findings,
    gates,
  };

  if (!quiet && !promptStdout) {
    printReport(report, triage, suppressedCount);
  }

  // Prompt stdout — just print and exit (for piping)
  if (promptStdout) {
    const prompt = generatePrompt(report, triage);
    process.stdout.write(prompt);
    process.exit(summary.status === 'fail' ? 1 : 0);
  }

  const outDir = resolve(outputDir);

  if (exportJsonFlag) {
    const path = exportJson(report, outDir);
    console.log(`  JSON report: ${path}`);
  }

  if (exportMdFlag) {
    const path = exportMarkdown(report, outDir);
    console.log(`  Markdown report: ${path}`);
  }

  if (exportHtmlFlag) {
    const path = exportHtml(report, outDir, triage, scanCtx);
    console.log(`  HTML report: ${path}`);
  }

  if (exportFixesFlag) {
    const path = exportFixes(report, triage, outDir);
    console.log(`  Fix guide: ${path}`);
  }

  if (exportPromptFlag) {
    const path = exportPrompt(report, triage, outDir);
    console.log(`  AI prompt: ${path}`);
  }

  if (exportRoadmapFlag) {
    const roadmap = generateRoadmap(findings, scores, gates, triage);
    const path = exportRoadmap(roadmap, outDir);
    console.log(`  Roadmap: ${path}`);
  }

  if (exportPurposeFlag) {
    const pr = analyzePromiseVsReality(scanCtx, findings);
    const plan = generatePurposePlan(pr, framework);
    const path = exportPurposePlan(plan, outDir);
    console.log(`  Purpose plan: ${path}`);
  }

  if (exportRulesFlag) {
    const path = exportAgentRules(report, outDir, rulesFormat);
    console.log(`  Agent rules: ${path}`);
  }

  // Exit code based on status
  if (summary.status === 'fail') process.exit(1);
  process.exit(0);
}

main().catch(err => {
  console.error('FLAW error:', err.message);
  process.exit(2);
});
