// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
/**
 * FLAW Interactive REPL
 * Launch with `flaw` (no args) or `flaw --interactive`
 */

import { createInterface, type Interface } from 'node:readline';
import { resolve, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { scan, type ScanResult } from './scanner.js';
import { computeCategoryScores, computeSmellIndex, computeGates, computeSummary } from './scorer.js';
import { printReport, exportJson, exportMarkdown } from './reporter.js';
import { exportHtml } from './html-reporter.js';
import { loadIgnoreRules, applyIgnoreRules } from './ignore.js';
import { computeTriage } from './triage.js';
import { exportFixes } from './fix-reporter.js';
import { generatePrompt, exportPrompt } from './prompt-reporter.js';
import { startWatchMode } from './watcher.js';
import { generateRoadmap, exportRoadmap } from './roadmap.js';
import { exportAgentRules, generateAgentRules } from './rules-generator.js';
import { analyzePromiseVsReality } from './promise-reality.js';
import { generatePurposePlan, exportPurposePlan } from './purpose-plan.js';
import { diagnoseSymptoms } from './symptoms.js';
import { getGitBranch, getGitCommit, getGitRepoName } from '../utils/git.js';
import { findPackageJson, detectFramework } from '../utils/fs.js';
import { c, severityColor, bar } from '../utils/colors.js';
import type { AuditReport, TriageResult, AnalyzerContext, Finding } from '../types/index.js';

interface ReplSession {
  root: string;
  outputDir: string;
  noIgnore: boolean;
  report: AuditReport | null;
  triage: TriageResult | null;
  scanCtx: AnalyzerContext | null;
  suppressedCount: number;
}

interface Command {
  name: string;
  aliases: string[];
  desc: string;
  usage?: string;
  handler: (session: ReplSession, args: string[]) => Promise<void>;
}

const VERSION = '2.0.0';

// ─── Compact Formatters ──────────────────────────────────────────

function printScore(report: AuditReport) {
  const { summary, scores, smellIndex } = report;
  const scoreColor = summary.totalScore >= 75 ? c.green : summary.totalScore >= 60 ? c.yellow : c.red;

  console.log('');
  console.log(`  ${c.bold}Score${c.reset}  ${scoreColor}${c.bold}${summary.totalScore}${c.reset}${c.dim}/100${c.reset}  ${bar(summary.totalScore, 100, 24)}`);
  console.log(`  ${c.bold}Rating${c.reset} ${summary.rating.replace(/-/g, ' ')}`);
  console.log(`  ${c.bold}Status${c.reset} ${summary.status === 'pass' ? `${c.green}SHIP${c.reset}` : summary.status === 'conditional-pass' ? `${c.yellow}REVIEW${c.reset}` : `${c.red}BLOCK${c.reset}`}`);
  console.log(`  ${c.bold}Smell${c.reset}  ${smellIndex.score >= 6 ? c.red : smellIndex.score >= 3 ? c.yellow : c.green}${smellIndex.score}${c.reset}${c.dim}/${smellIndex.maxScore} (${smellIndex.level})${c.reset}`);
  console.log(`  ${c.bold}Issues${c.reset} ${c.red}${summary.criticalCount}C${c.reset} ${c.yellow}${summary.highCount}H${c.reset} ${c.cyan}${summary.mediumCount}M${c.reset} ${c.dim}${summary.lowCount}L${c.reset}`);
  console.log('');

  for (const cat of scores) {
    const pct = cat.score / cat.maxScore;
    const col = pct >= 0.75 ? c.green : pct >= 0.5 ? c.yellow : c.red;
    const nameShort = cat.categoryName.length > 36 ? cat.categoryName.slice(0, 36) + '...' : cat.categoryName;
    console.log(`  ${c.dim}${nameShort.padEnd(40)}${c.reset} ${bar(cat.score, cat.maxScore, 12)} ${col}${cat.score}${c.reset}${c.dim}/${cat.maxScore}${c.reset}`);
  }
  console.log('');
}

function printTriageSummary(triage: TriageResult) {
  console.log('');
  if (triage.topThree.length === 0) {
    console.log(`  ${c.green}No critical issues to triage.${c.reset}`);
    return;
  }
  console.log(`  ${c.bold}Fix These First${c.reset}`);
  console.log(`  ${c.dim}${'─'.repeat(50)}${c.reset}`);
  for (let i = 0; i < triage.topThree.length; i++) {
    const f = triage.topThree[i];
    console.log(`  ${c.bold}${i + 1}.${c.reset} ${severityColor(f.severity)}${f.severity.toUpperCase().padEnd(8)}${c.reset} ${f.title}`);
    console.log(`     ${c.dim}${f.location.file}${f.location.startLine ? `:${f.location.startLine}` : ''}${c.reset}`);
  }
  console.log('');

  for (const g of triage.groups) {
    const blastCol = g.blastRadius === 'critical' ? c.red : g.blastRadius === 'high' ? c.yellow : c.cyan;
    console.log(`  ${c.bold}P${g.priority}${c.reset} ${blastCol}${g.blastRadius.toUpperCase()}${c.reset} ${g.label} ${c.dim}(${g.findings.length} issues)${c.reset}`);
  }
  console.log('');
}

function printSymptomsSummary(findings: Finding[]) {
  const symptoms = diagnoseSymptoms(findings);
  console.log('');
  if (symptoms.length === 0) {
    console.log(`  ${c.green}No user-visible symptoms detected.${c.reset}`);
    return;
  }
  console.log(`  ${c.bold}Why You're Experiencing Problems${c.reset}`);
  console.log(`  ${c.dim}${'─'.repeat(50)}${c.reset}`);
  for (const s of symptoms.slice(0, 8)) {
    console.log(`  ${c.cyan}${s.icon.padEnd(7)}${c.reset} ${c.bold}${s.headline}${c.reset} ${c.dim}(${s.findings.length} causes)${c.reset}`);
    const desc = s.explanation.length > 70 ? s.explanation.slice(0, 70) + '...' : s.explanation;
    console.log(`         ${c.dim}${desc}${c.reset}`);
  }
  if (symptoms.length > 8) {
    console.log(`  ${c.dim}...and ${symptoms.length - 8} more${c.reset}`);
  }
  console.log('');
}

function printPromiseSummary(ctx: AnalyzerContext, findings: Finding[]) {
  const pr = analyzePromiseVsReality(ctx, findings);
  console.log('');
  console.log(`  ${c.bold}Promise vs Reality${c.reset}  ${c.dim}Score: ${pr.realityScore >= 70 ? c.green : pr.realityScore >= 40 ? c.yellow : c.red}${pr.realityScore}%${c.reset}`);
  console.log(`  ${c.dim}${'─'.repeat(50)}${c.reset}`);
  if (pr.claims.length === 0) {
    console.log(`  ${c.dim}No feature claims detected in README.${c.reset}`);
  }
  for (const claim of pr.claims) {
    const icon = claim.status === 'implemented' ? `${c.green}✓${c.reset}`
      : claim.status === 'partial' ? `${c.yellow}◑${c.reset}`
      : claim.status === 'stub' ? `${c.dim}○${c.reset}`
      : `${c.red}✗${c.reset}`;
    console.log(`  ${icon} ${claim.claim.padEnd(28)} ${c.dim}${claim.status}${c.reset}`);
  }
  console.log('');
  console.log(`  ${c.italic}${pr.verdict}${c.reset}`);
  console.log('');
}

function printRoadmapSummary(report: AuditReport, triage?: TriageResult) {
  const findings = report.findings.filter(f => f.status === 'open');
  const roadmap = generateRoadmap(findings, report.scores, report.gates, triage);
  console.log('');
  console.log(`  ${c.bold}Production Roadmap${c.reset}  ${c.dim}${roadmap.estimatedPhases} phases${c.reset}`);
  console.log(`  ${c.dim}${'─'.repeat(50)}${c.reset}`);
  console.log(`  ${c.italic}${roadmap.summary}${c.reset}`);
  console.log('');
  for (const phase of roadmap.phases) {
    const col = phase.phase === 1 ? c.red : phase.phase === 2 ? c.yellow : c.cyan;
    console.log(`  ${col}Phase ${phase.phase}${c.reset} ${c.bold}${phase.title}${c.reset} ${c.dim}(${phase.items.length} items · ${phase.effort})${c.reset}`);
    for (const item of phase.items.slice(0, 3)) {
      console.log(`    ${severityColor(item.severity)}▸${c.reset} ${item.title} ${c.dim}${item.file}${c.reset}`);
    }
    if (phase.items.length > 3) {
      console.log(`    ${c.dim}...and ${phase.items.length - 3} more${c.reset}`);
    }
  }
  console.log('');
}

function printPurposeSummary(ctx: AnalyzerContext, findings: Finding[], framework?: string) {
  const pr = analyzePromiseVsReality(ctx, findings);
  const plan = generatePurposePlan(pr, framework);
  console.log('');
  console.log(`  ${c.bold}Purpose Alignment${c.reset}  ${c.dim}Reality: ${pr.realityScore}%${c.reset}`);
  console.log(`  ${c.dim}${'─'.repeat(50)}${c.reset}`);
  console.log(`  ${c.italic}${plan.summary}${c.reset}`);
  console.log('');
  for (const gap of plan.gaps.slice(0, 6)) {
    const prioCol = gap.priority === 'must-have' ? c.red : gap.priority === 'should-have' ? c.yellow : c.dim;
    const statusTag = gap.status === 'missing' ? `${c.red}MISSING${c.reset}` : gap.status === 'stub' ? `${c.dim}STUB${c.reset}` : `${c.yellow}PARTIAL${c.reset}`;
    console.log(`  ${prioCol}${gap.priority.toUpperCase().padEnd(12)}${c.reset} ${gap.feature.padEnd(24)} ${statusTag} ${c.dim}${gap.estimatedEffort}${c.reset}`);
  }
  if (plan.gaps.length > 6) console.log(`  ${c.dim}...and ${plan.gaps.length - 6} more gaps${c.reset}`);
  console.log('');
}

// ─── Core Scan Logic ──────────────────────────────────────────

async function runScan(session: ReplSession): Promise<void> {
  const root = session.root;
  const startTime = Date.now();
  const { findings: rawFindings, smellHits, ctx } = await scan(root);
  const durationMs = Date.now() - startTime;

  let findings = rawFindings;
  let suppressedCount = 0;
  if (!session.noIgnore) {
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
    audit: { type: 'launch-readiness', mode: 'static', durationMs },
    summary,
    scores,
    smellIndex,
    findings,
    gates,
  };

  session.report = report;
  session.triage = triage;
  session.scanCtx = ctx;
  session.suppressedCount = suppressedCount;
}

// ─── Commands ──────────────────────────────────────────────────

function requireScan(session: ReplSession): boolean {
  if (!session.report) {
    console.log(`\n  ${c.yellow}No scan data. Run ${c.bold}/scan${c.reset}${c.yellow} first.${c.reset}\n`);
    return false;
  }
  return true;
}

const commands: Command[] = [
  {
    name: '/scan',
    aliases: ['/s', '/audit'],
    desc: 'Scan the project (or a new path)',
    usage: '/scan [path]',
    handler: async (session, args) => {
      if (args[0]) {
        const newRoot = resolve(args[0]);
        if (!existsSync(newRoot)) {
          console.log(`\n  ${c.red}Path not found: ${newRoot}${c.reset}\n`);
          return;
        }
        session.root = newRoot;
      }
      const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let i = 0;
      const interval = setInterval(() => {
        process.stdout.write(`\r  ${c.cyan}${spinner[i++ % spinner.length]}${c.reset} Scanning ${c.dim}${session.root}${c.reset}`);
      }, 80);

      try {
        await runScan(session);
        clearInterval(interval);
        process.stdout.write('\r' + ' '.repeat(80) + '\r');

        const r = session.report!;
        const scoreCol = r.summary.totalScore >= 75 ? c.green : r.summary.totalScore >= 60 ? c.yellow : c.red;
        const open = r.findings.filter(f => f.status === 'open').length;
        console.log(`  ${c.green}✓${c.reset} Scanned ${c.bold}${r.project.name}${c.reset} in ${r.audit.durationMs}ms`);
        console.log(`    ${scoreCol}${c.bold}${r.summary.totalScore}/100${c.reset} · ${c.red}${r.summary.criticalCount}C${c.reset} ${c.yellow}${r.summary.highCount}H${c.reset} ${c.cyan}${r.summary.mediumCount}M${c.reset} · ${open} issues · ${r.smellIndex.level} smell`);
        console.log('');
      } catch (err: any) {
        clearInterval(interval);
        process.stdout.write('\r' + ' '.repeat(80) + '\r');
        console.log(`\n  ${c.red}Scan failed: ${err.message}${c.reset}\n`);
      }
    },
  },
  {
    name: '/score',
    aliases: ['/sc'],
    desc: 'Show score breakdown',
    handler: async (session) => {
      if (!requireScan(session)) return;
      printScore(session.report!);
    },
  },
  {
    name: '/report',
    aliases: ['/r'],
    desc: 'Print full terminal report',
    handler: async (session) => {
      if (!requireScan(session)) return;
      printReport(session.report!, session.triage!, session.suppressedCount);
    },
  },
  {
    name: '/triage',
    aliases: ['/t'],
    desc: 'Show triage priority groups',
    handler: async (session) => {
      if (!requireScan(session)) return;
      printTriageSummary(session.triage!);
    },
  },
  {
    name: '/symptoms',
    aliases: ['/sy'],
    desc: 'Diagnose user-visible problems',
    handler: async (session) => {
      if (!requireScan(session)) return;
      printSymptomsSummary(session.report!.findings);
    },
  },
  {
    name: '/promise',
    aliases: ['/pr'],
    desc: 'Promise vs Reality analysis',
    handler: async (session) => {
      if (!requireScan(session)) return;
      if (!session.scanCtx) { console.log(`\n  ${c.yellow}No scan context available.${c.reset}\n`); return; }
      printPromiseSummary(session.scanCtx, session.report!.findings.filter(f => f.status === 'open'));
    },
  },
  {
    name: '/roadmap',
    aliases: ['/rm'],
    desc: 'Show production readiness roadmap',
    usage: '/roadmap [--export]',
    handler: async (session, args) => {
      if (!requireScan(session)) return;
      if (args.includes('--export')) {
        const findings = session.report!.findings.filter(f => f.status === 'open');
        const roadmap = generateRoadmap(findings, session.report!.scores, session.report!.gates, session.triage!);
        const path = exportRoadmap(roadmap, session.outputDir);
        console.log(`\n  ${c.green}✓${c.reset} Exported: ${c.underline}${path}${c.reset}\n`);
      } else {
        printRoadmapSummary(session.report!, session.triage!);
      }
    },
  },
  {
    name: '/purpose',
    aliases: ['/pp'],
    desc: 'Purpose alignment plan — close feature gaps',
    usage: '/purpose [--export]',
    handler: async (session, args) => {
      if (!requireScan(session)) return;
      if (!session.scanCtx) return;
      const open = session.report!.findings.filter(f => f.status === 'open');
      if (args.includes('--export')) {
        const pr = analyzePromiseVsReality(session.scanCtx, open);
        const plan = generatePurposePlan(pr, session.report!.project.framework);
        const path = exportPurposePlan(plan, session.outputDir);
        console.log(`\n  ${c.green}✓${c.reset} Exported: ${c.underline}${path}${c.reset}\n`);
      } else {
        printPurposeSummary(session.scanCtx, open, session.report!.project.framework);
      }
    },
  },
  {
    name: '/rules',
    aliases: ['/ru'],
    desc: 'Generate agent rules file',
    usage: '/rules [--md]',
    handler: async (session, args) => {
      if (!requireScan(session)) return;
      const format = args.includes('--md') ? 'md' as const : 'cursorrules' as const;
      const path = exportAgentRules(session.report!, session.outputDir, format);
      console.log(`\n  ${c.green}✓${c.reset} Exported: ${c.underline}${path}${c.reset}\n`);
    },
  },
  {
    name: '/html',
    aliases: ['/h'],
    desc: 'Export HTML report',
    handler: async (session) => {
      if (!requireScan(session)) return;
      const path = exportHtml(session.report!, session.outputDir, session.triage!, session.scanCtx!);
      console.log(`\n  ${c.green}✓${c.reset} Exported: ${c.underline}${path}${c.reset}\n`);
    },
  },
  {
    name: '/json',
    aliases: ['/j'],
    desc: 'Export JSON report',
    handler: async (session) => {
      if (!requireScan(session)) return;
      const path = exportJson(session.report!, session.outputDir);
      console.log(`\n  ${c.green}✓${c.reset} Exported: ${c.underline}${path}${c.reset}\n`);
    },
  },
  {
    name: '/fixes',
    aliases: ['/f'],
    desc: 'Export fix guide',
    handler: async (session) => {
      if (!requireScan(session)) return;
      const path = exportFixes(session.report!, session.triage!, session.outputDir);
      console.log(`\n  ${c.green}✓${c.reset} Exported: ${c.underline}${path}${c.reset}\n`);
    },
  },
  {
    name: '/prompt',
    aliases: ['/p'],
    desc: 'Generate AI-ready prompt',
    usage: '/prompt [--stdout | --export]',
    handler: async (session, args) => {
      if (!requireScan(session)) return;
      if (args.includes('--stdout')) {
        const prompt = generatePrompt(session.report!, session.triage!);
        process.stdout.write(prompt);
        console.log('');
      } else if (args.includes('--export')) {
        const path = exportPrompt(session.report!, session.triage!, session.outputDir);
        console.log(`\n  ${c.green}✓${c.reset} Exported: ${c.underline}${path}${c.reset}\n`);
      } else {
        const prompt = generatePrompt(session.report!, session.triage!);
        const lines = prompt.split('\n');
        console.log('');
        for (const line of lines.slice(0, 30)) {
          console.log(`  ${c.dim}${line}${c.reset}`);
        }
        if (lines.length > 30) console.log(`  ${c.dim}... (${lines.length - 30} more lines — use /prompt --export)${c.reset}`);
        console.log('');
      }
    },
  },
  {
    name: '/watch',
    aliases: ['/w'],
    desc: 'Enter watch mode (live re-scan on file changes)',
    handler: async (session) => {
      console.log(`\n  ${c.cyan}Entering watch mode...${c.reset} ${c.dim}(Ctrl+C to exit)${c.reset}\n`);
      await startWatchMode(session.root);
    },
  },
  {
    name: '/all',
    aliases: ['/a'],
    desc: 'Export everything (HTML, JSON, fixes, roadmap, rules, purpose plan)',
    handler: async (session) => {
      if (!requireScan(session)) return;
      const dir = session.outputDir;
      const paths: string[] = [];
      paths.push(exportHtml(session.report!, dir, session.triage!, session.scanCtx!));
      paths.push(exportJson(session.report!, dir));
      paths.push(exportFixes(session.report!, session.triage!, dir));
      const findings = session.report!.findings.filter(f => f.status === 'open');
      const roadmap = generateRoadmap(findings, session.report!.scores, session.report!.gates, session.triage!);
      paths.push(exportRoadmap(roadmap, dir));
      paths.push(exportAgentRules(session.report!, dir));
      if (session.scanCtx) {
        const pr = analyzePromiseVsReality(session.scanCtx, findings);
        const plan = generatePurposePlan(pr, session.report!.project.framework);
        paths.push(exportPurposePlan(plan, dir));
      }
      console.log('');
      for (const p of paths) {
        console.log(`  ${c.green}✓${c.reset} ${p}`);
      }
      console.log('');
    },
  },
  {
    name: '/clear',
    aliases: ['/cl'],
    desc: 'Clear the screen',
    handler: async () => {
      process.stdout.write('\x1b[2J\x1b[H');
    },
  },
  {
    name: '/help',
    aliases: ['/?'],
    desc: 'Show available commands',
    handler: async () => {
      console.log('');
      console.log(`  ${c.bold}Commands${c.reset}`);
      console.log(`  ${c.dim}${'─'.repeat(56)}${c.reset}`);
      for (const cmd of commands) {
        if (cmd.name === '/quit') continue;
        const aliases = cmd.aliases.length > 0 ? ` ${c.dim}(${cmd.aliases.join(', ')})${c.reset}` : '';
        console.log(`  ${c.cyan}${(cmd.usage || cmd.name).padEnd(28)}${c.reset} ${cmd.desc}${aliases}`);
      }
      console.log(`  ${c.cyan}${'/quit'.padEnd(28)}${c.reset} Exit FLAW`);
      console.log('');
      console.log(`  ${c.dim}Tip: Tab to autocomplete commands. Arrow keys for history.${c.reset}`);
      console.log('');
    },
  },
  {
    name: '/quit',
    aliases: ['/q', '/exit'],
    desc: 'Exit',
    handler: async () => {
      console.log(`\n  ${c.dim}Goodbye.${c.reset}\n`);
      process.exit(0);
    },
  },
];

// ─── Fuzzy Match ──────────────────────────────────────────────

function findCommand(input: string): Command | null {
  const normalized = input.startsWith('/') ? input : `/${input}`;
  for (const cmd of commands) {
    if (cmd.name === normalized || cmd.aliases.includes(normalized)) return cmd;
  }
  return null;
}

function suggestCommand(input: string): string | null {
  const normalized = input.startsWith('/') ? input : `/${input}`;
  let best: string | null = null;
  let bestScore = 0;
  for (const cmd of commands) {
    const all = [cmd.name, ...cmd.aliases];
    for (const name of all) {
      let score = 0;
      for (let i = 0; i < Math.min(normalized.length, name.length); i++) {
        if (normalized[i] === name[i]) score++;
        else break;
      }
      if (score > bestScore) { bestScore = score; best = cmd.name; }
    }
  }
  return bestScore >= 2 ? best : null;
}

// ─── Tab Completer ──────────────────────────────────────────────

function completer(line: string): [string[], string] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) {
    const allNames = commands.map(cmd => cmd.name);
    return [allNames.filter(n => n.startsWith('/' + trimmed)), trimmed];
  }
  const allNames: string[] = [];
  for (const cmd of commands) {
    allNames.push(cmd.name, ...cmd.aliases);
  }
  const hits = allNames.filter(n => n.startsWith(trimmed));
  return [hits, trimmed];
}

// ─── Splash ──────────────────────────────────────────────────

function printSplash() {
  console.log('');
  console.log(`  ${c.bold}${c.red}╺╸${c.reset}${c.bold} FLAW${c.reset} ${c.dim}v${VERSION}${c.reset}`);
  console.log(`  ${c.dim}Flow Logic Audit Watch${c.reset}`);
  console.log('');
  console.log(`  ${c.dim}Type ${c.reset}${c.cyan}/help${c.reset}${c.dim} for commands or ${c.reset}${c.cyan}/scan${c.reset}${c.dim} to start.${c.reset}`);
  console.log('');
}

// ─── Main REPL ──────────────────────────────────────────────────

export async function startRepl(root: string, outputDir: string = '.', noIgnore: boolean = false, autoScan: boolean = true): Promise<void> {
  const session: ReplSession = {
    root: resolve(root),
    outputDir: resolve(outputDir),
    noIgnore,
    report: null,
    triage: null,
    scanCtx: null,
    suppressedCount: 0,
  };

  printSplash();

  // Auto-scan if a path was provided
  if (autoScan && existsSync(session.root)) {
    const scanCmd = findCommand('/scan')!;
    await scanCmd.handler(session, []);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
    prompt: `  ${c.red}╺╸${c.reset} `,
    terminal: true,
  });

  // History tracking
  const history: string[] = [];

  function promptUser() {
    rl.prompt();
  }

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      promptUser();
      return;
    }

    history.push(trimmed);

    const parts = trimmed.split(/\s+/);
    const cmdName = parts[0];
    const args = parts.slice(1);

    const cmd = findCommand(cmdName);
    if (cmd) {
      try {
        await cmd.handler(session, args);
      } catch (err: any) {
        console.log(`\n  ${c.red}Error: ${err.message}${c.reset}\n`);
      }
    } else {
      const suggestion = suggestCommand(cmdName);
      if (suggestion) {
        console.log(`\n  ${c.yellow}Unknown command.${c.reset} Did you mean ${c.cyan}${suggestion}${c.reset}?\n`);
      } else {
        console.log(`\n  ${c.yellow}Unknown command.${c.reset} Type ${c.cyan}/help${c.reset} for available commands.\n`);
      }
    }

    promptUser();
  });

  rl.on('close', () => {
    console.log(`\n  ${c.dim}Goodbye.${c.reset}\n`);
    process.exit(0);
  });

  promptUser();
}
