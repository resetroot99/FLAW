// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
/**
 * GitHub Actions Reporter
 * Outputs findings as GitHub annotations, Job Summary, and machine-readable outputs.
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditReport, Finding, TriageResult } from '../types/index.js';

// ── GitHub Actions Annotations ──────────────────────────────────
// These appear inline on PR diffs, pointing to exact files and lines.

function severityToLevel(severity: string): 'error' | 'warning' | 'notice' {
  switch (severity) {
    case 'critical': return 'error';
    case 'high': return 'error';
    case 'medium': return 'warning';
    default: return 'notice';
  }
}

function emitAnnotations(findings: Finding[]): void {
  const open = findings.filter(f => f.status === 'open');
  // Cap at 50 — GitHub ignores annotations beyond that
  for (const f of open.slice(0, 50)) {
    const level = severityToLevel(f.severity);
    const file = f.location.file || '';
    const line = f.location.startLine || 1;
    const title = `[${f.ruleId}] ${f.title}`;
    const msg = f.summary.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::${level} file=${file},line=${line},title=${title}::${msg}`);
  }
}

// ── GitHub Job Summary ──────────────────────────────────────────
// Rendered in the Actions > Summary tab as rich markdown.

function buildJobSummary(report: AuditReport, triage?: TriageResult): string {
  const { summary, scores, findings, smellIndex } = report;
  const open = findings.filter(f => f.status === 'open');

  const scoreIcon = summary.totalScore >= 80 ? '🟢' : summary.totalScore >= 60 ? '🟡' : summary.totalScore >= 40 ? '🟠' : '🔴';
  const statusIcon = summary.status === 'pass' ? '✅' : summary.status === 'conditional-pass' ? '⚠️' : '❌';
  const filled = Math.round(summary.totalScore / 5);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);

  const lines: string[] = [];

  lines.push(`## ${statusIcon} FLAW — Code Integrity Audit`);
  lines.push('');
  lines.push(`${scoreIcon} **Score: ${summary.totalScore}/100** \`${bar}\``);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| **Rating** | ${summary.rating.replace(/-/g, ' ')} |`);
  lines.push(`| **Status** | ${summary.status === 'pass' ? 'PASS' : summary.status === 'conditional-pass' ? 'REVIEW' : 'FAIL'} |`);
  lines.push(`| **Findings** | ${open.length} open (${summary.criticalCount} critical, ${summary.highCount} high, ${summary.mediumCount} medium) |`);
  lines.push(`| **Smell Index** | ${smellIndex.score}/${smellIndex.maxScore} (${smellIndex.level}) |`);
  lines.push('');

  // Category breakdown
  lines.push('### Category Breakdown');
  lines.push('');
  lines.push('| Category | Score | |');
  lines.push('|----------|-------|-|');
  for (const cat of scores) {
    const pct = cat.maxScore > 0 ? cat.score / cat.maxScore : 1;
    const icon = pct >= 0.75 ? '✅' : pct >= 0.5 ? '⚠️' : '❌';
    const catBar = '█'.repeat(Math.round(pct * 10)) + '░'.repeat(10 - Math.round(pct * 10));
    lines.push(`| ${cat.categoryName} | ${cat.score}/${cat.maxScore} | ${icon} \`${catBar}\` |`);
  }
  lines.push('');

  // Top findings
  const critical = open.filter(f => f.severity === 'critical' || f.severity === 'high');
  if (critical.length > 0) {
    lines.push('### Top Findings');
    lines.push('');
    lines.push('| Sev | Rule | Title | File |');
    lines.push('|-----|------|-------|------|');
    for (const f of critical.slice(0, 15)) {
      const sevIcon = f.severity === 'critical' ? '🔴' : '🟠';
      const file = f.location.file ? `\`${f.location.file}${f.location.startLine ? ':' + f.location.startLine : ''}\`` : '—';
      lines.push(`| ${sevIcon} | \`${f.ruleId}\` | ${f.title} | ${file} |`);
    }
    if (critical.length > 15) {
      lines.push(`| | | ... and ${critical.length - 15} more | |`);
    }
    lines.push('');
  }

  // Fix priorities from triage
  if (triage && triage.topThree.length > 0) {
    lines.push('### Fix These First');
    lines.push('');
    for (let i = 0; i < triage.topThree.length; i++) {
      const f = triage.topThree[i];
      lines.push(`${i + 1}. **${f.title}** — \`${f.location.file || 'unknown'}\``);
      if (f.suggestedFix) lines.push(`   > ${f.suggestedFix}`);
    }
    lines.push('');
  }

  // Gates
  const failedGates = report.gates.filter(g => g.status === 'fail');
  if (failedGates.length > 0) {
    lines.push('### Launch Blockers');
    lines.push('');
    for (const g of failedGates) {
      lines.push(`- ❌ **${g.label}**${g.reason ? ' — ' + g.reason : ''}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*Audited by [FLAW](https://github.com/resetroot99/FLAW) — Flow Logic Audit Watch*');

  return lines.join('\n');
}

function writeJobSummary(markdown: string): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(summaryFile, markdown + '\n');
  }
}

// ── GitHub Outputs ──────────────────────────────────────────────

function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    if (value.includes('\n')) {
      appendFileSync(outputFile, `${name}<<FLAW_EOF\n${value}\nFLAW_EOF\n`);
    } else {
      appendFileSync(outputFile, `${name}=${value}\n`);
    }
  }
}

function writeOutputs(report: AuditReport): void {
  const { summary, scores, findings } = report;
  const open = findings.filter(f => f.status === 'open');

  setOutput('score', String(summary.totalScore));
  setOutput('rating', summary.rating);
  setOutput('status', summary.status === 'pass' ? 'PASS' : summary.status === 'conditional-pass' ? 'REVIEW' : 'FAIL');
  setOutput('findings', String(open.length));
  setOutput('critical_count', String(summary.criticalCount));
  setOutput('high_count', String(summary.highCount));

  // Top findings as JSON (single line for ${{ }} usage)
  const topFindings = open
    .filter(f => f.severity === 'critical' || f.severity === 'high')
    .slice(0, 10)
    .map(f => ({ severity: f.severity, title: f.title, ruleId: f.ruleId, file: f.location.file || '' }));
  setOutput('top_findings', JSON.stringify(topFindings));

  // Category breakdown
  const categories = scores.map(s => ({
    name: s.categoryName,
    score: s.score,
    maxScore: s.maxScore,
  }));
  setOutput('categories', JSON.stringify(categories));
}

// ── JSON to stdout ──────────────────────────────────────────────

function writeJsonStdout(report: AuditReport): void {
  process.stdout.write(JSON.stringify(report, null, 2));
}

// ── Main entry point ────────────────────────────────────────────

export function runGitHubReporter(report: AuditReport, triage?: TriageResult): void {
  // 1. Emit file annotations on the PR diff
  emitAnnotations(report.findings);

  // 2. Write Job Summary (Actions > Summary tab)
  const summaryMd = buildJobSummary(report, triage);
  writeJobSummary(summaryMd);

  // 3. Set outputs for downstream steps
  writeOutputs(report);

  // 4. Write JSON report to a predictable path
  const reportPath = join(process.env.RUNNER_TEMP || '/tmp', 'flaw-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // 5. Print summary line to Actions log
  const s = report.summary;
  console.log(`FLAW: ${s.totalScore}/100 — ${s.criticalCount}C ${s.highCount}H ${s.mediumCount}M — ${s.status === 'pass' ? 'PASS' : 'FAIL'}`);
}

export function writeJsonToStdout(report: AuditReport): void {
  writeJsonStdout(report);
}
