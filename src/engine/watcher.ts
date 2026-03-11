// Watch mode — re-scan on file save, show delta
import { watch } from 'node:fs';
import { resolve } from 'node:path';
import { scan } from './scanner.js';
import { computeCategoryScores, computeSmellIndex, computeGates, computeSummary } from './scorer.js';
import { loadIgnoreRules, applyIgnoreRules } from './ignore.js';
import type { Finding, AuditSummary } from '../types/index.js';

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

interface ScanSnapshot {
  findings: Finding[];
  summary: AuditSummary;
  timestamp: number;
}

function findingKey(f: Finding): string {
  return `${f.ruleId}|${f.location.file}|${f.location.startLine || 0}`;
}

function computeDelta(prev: ScanSnapshot, curr: ScanSnapshot): {
  newFindings: Finding[];
  resolvedFindings: Finding[];
  scoreChange: number;
} {
  const prevKeys = new Set(prev.findings.filter(f => f.status === 'open').map(findingKey));
  const currKeys = new Set(curr.findings.filter(f => f.status === 'open').map(findingKey));

  const newFindings = curr.findings.filter(f => f.status === 'open' && !prevKeys.has(findingKey(f)));
  const resolvedFindings = prev.findings.filter(f => f.status === 'open' && !currKeys.has(findingKey(f)));
  const scoreChange = curr.summary.totalScore - prev.summary.totalScore;

  return { newFindings, resolvedFindings, scoreChange };
}

async function runScan(root: string): Promise<ScanSnapshot> {
  const { findings, smellHits } = await scan(root);
  const rules = loadIgnoreRules(root);
  const { filtered } = applyIgnoreRules(findings, rules);
  const scores = computeCategoryScores(filtered);
  const smellIndex = computeSmellIndex(smellHits);
  const gates = computeGates(filtered);
  const summary = computeSummary(scores, filtered, smellIndex, gates);

  return { findings: filtered, summary, timestamp: Date.now() };
}

function printDelta(
  changedFile: string,
  delta: { newFindings: Finding[]; resolvedFindings: Finding[]; scoreChange: number },
  current: ScanSnapshot,
) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const { summary } = current;

  console.log('');
  console.log(`  ${c.dim}[${time}]${c.reset} ${changedFile}`);
  console.log('');

  // Score delta
  const arrow = delta.scoreChange > 0 ? `${c.green}+${delta.scoreChange}` : delta.scoreChange < 0 ? `${c.red}${delta.scoreChange}` : `${c.dim}±0`;
  const scoreColor = summary.totalScore >= 75 ? c.green : summary.totalScore >= 60 ? c.yellow : c.red;
  console.log(`  Score: ${scoreColor}${summary.totalScore}${c.reset}/100 (${arrow}${c.reset})`);
  console.log('');

  // Resolved findings
  for (const f of delta.resolvedFindings) {
    console.log(`  ${c.green}✓ RESOLVED:${c.reset} ${f.title}`);
    console.log(`    ${c.dim}${f.location.file}${f.location.startLine ? `:${f.location.startLine}` : ''}${c.reset}`);
  }

  // New findings
  for (const f of delta.newFindings) {
    const sevColor = f.severity === 'critical' ? c.red : f.severity === 'high' ? c.yellow : c.cyan;
    console.log(`  ${c.red}✕ NEW:${c.reset} ${sevColor}${f.severity.toUpperCase()}${c.reset} ${f.title}`);
    console.log(`    ${c.dim}${f.location.file}${f.location.startLine ? `:${f.location.startLine}` : ''}${c.reset}`);
    if (f.suggestedFix) {
      console.log(`    ${c.dim}Fix: ${f.suggestedFix}${c.reset}`);
    }
  }

  if (delta.newFindings.length === 0 && delta.resolvedFindings.length === 0) {
    console.log(`  ${c.dim}No changes in findings.${c.reset}`);
  }

  console.log('');
  console.log(`  ${c.red}${summary.criticalCount} critical${c.reset} · ${c.yellow}${summary.highCount} high${c.reset} · ${c.cyan}${summary.mediumCount} medium${c.reset} · ${c.dim}${summary.lowCount} low${c.reset} remaining`);
  console.log(`  ${c.dim}Watching for changes... (Ctrl+C to stop)${c.reset}`);
}

export async function startWatchMode(root: string): Promise<void> {
  console.log(`\n  ${c.bold}FLAW Watch Mode${c.reset} — ${root}`);
  console.log(`  ${c.dim}Running initial scan...${c.reset}\n`);

  let previous = await runScan(root);
  const { summary } = previous;
  const openCount = previous.findings.filter(f => f.status === 'open').length;

  console.log(`  Initial scan: ${summary.totalScore}/100 | ${openCount} findings`);
  console.log(`  ${c.red}${summary.criticalCount} critical${c.reset} · ${c.yellow}${summary.highCount} high${c.reset} · ${c.cyan}${summary.mediumCount} medium${c.reset} · ${c.dim}${summary.lowCount} low${c.reset}`);
  console.log(`\n  ${c.dim}Watching for changes... (Ctrl+C to stop)${c.reset}`);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let scanning = false;

  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const fullPath = filename.toString();

    // Skip irrelevant files
    if (/node_modules|\.git|dist|build|__pycache__|\.pyc|\.flaw-/.test(fullPath)) return;
    if (!/\.(ts|tsx|js|jsx|py|rb|go|java|php|prisma|env|json|yaml|yml)$/.test(fullPath)) return;

    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(async () => {
      if (scanning) return;
      scanning = true;

      try {
        const current = await runScan(root);
        const delta = computeDelta(previous, current);
        printDelta(fullPath, delta, current);
        previous = current;
      } catch (err) {
        console.error(`  ${c.red}Scan error:${c.reset} ${(err as Error).message}`);
      } finally {
        scanning = false;
      }
    }, 500);
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    watcher.close();
    console.log(`\n  ${c.dim}Watch mode stopped.${c.reset}\n`);
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}
