import type { AuditReport, Finding, CategoryScore, SmellIndex, Gate, TriageResult } from '../types/index.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { diagnoseSymptoms } from './symptoms.js';

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return c.red;
    case 'high': return c.yellow;
    case 'medium': return c.cyan;
    case 'low': return c.dim;
    default: return c.dim;
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case 'pass': return `${c.green}PASS${c.reset}`;
    case 'fail': return `${c.red}FAIL${c.reset}`;
    case 'warning': return `${c.yellow}WARN${c.reset}`;
    case 'conditional-pass': return `${c.yellow}CONDITIONAL${c.reset}`;
    default: return status;
  }
}

function bar(score: number, max: number, width: number = 20): string {
  const filled = Math.round((score / max) * width);
  const empty = width - filled;
  const pct = score / max;
  const color = pct >= 0.75 ? c.green : pct >= 0.5 ? c.yellow : c.red;
  return `${color}${'█'.repeat(filled)}${c.dim}${'░'.repeat(empty)}${c.reset}`;
}

export function printReport(report: AuditReport, triage?: TriageResult, suppressedCount?: number): void {
  const { summary, scores, smellIndex, findings, gates } = report;

  console.log('');
  console.log(`${c.bold}╔══════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}║           FLAW — Flow Logic Audit Watch              ║${c.reset}`);
  console.log(`${c.bold}╚══════════════════════════════════════════════════════╝${c.reset}`);
  console.log('');

  // Project info
  console.log(`${c.dim}Project:${c.reset}   ${report.project.name}`);
  if (report.project.framework) {
    console.log(`${c.dim}Framework:${c.reset} ${report.project.framework}`);
  }
  if (report.project.branch) {
    console.log(`${c.dim}Branch:${c.reset}    ${report.project.branch} ${report.project.commitSha ? `(${report.project.commitSha})` : ''}`);
  }
  console.log(`${c.dim}Scanned:${c.reset}   ${report.generatedAt}`);
  console.log(`${c.dim}Duration:${c.reset}  ${report.audit.durationMs}ms`);
  console.log('');

  // Overall score
  const scoreColor = summary.totalScore >= 75 ? c.green : summary.totalScore >= 60 ? c.yellow : c.red;
  console.log(`${c.bold}Score: ${scoreColor}${summary.totalScore}${c.reset}${c.bold}/100${c.reset}  ${bar(summary.totalScore, 100, 30)}`);
  console.log(`${c.bold}Rating:${c.reset} ${summary.rating.replace(/-/g, ' ')}`);
  console.log(`${c.bold}Status:${c.reset} ${statusIcon(summary.status)}`);
  console.log('');

  // AI Smell Index
  const smellColor = smellIndex.score >= 6 ? c.red : smellIndex.score >= 3 ? c.yellow : c.green;
  console.log(`${c.bold}AI Smell Index:${c.reset} ${smellColor}${smellIndex.score}/${smellIndex.maxScore}${c.reset} (${smellIndex.level})`);
  if (smellIndex.smells.length > 0) {
    for (const smell of smellIndex.smells) {
      console.log(`  ${c.dim}•${c.reset} ${smell.label} ${c.dim}(×${smell.count})${c.reset}`);
    }
  }
  console.log('');

  // Issue counts
  const suppressedNote = suppressedCount ? ` ${c.dim}(${suppressedCount} suppressed by .flaw-ignore)${c.reset}` : '';
  console.log(`${c.bold}Issues:${c.reset} ${c.red}${summary.criticalCount} critical${c.reset} · ${c.yellow}${summary.highCount} high${c.reset} · ${c.cyan}${summary.mediumCount} medium${c.reset} · ${c.dim}${summary.lowCount} low${c.reset}${suppressedNote}`);
  console.log('');

  // Triage: Fix These First
  if (triage && triage.topThree.length > 0) {
    console.log(`${c.bold}${c.yellow}Fix These First${c.reset}`);
    console.log(`${c.dim}${'─'.repeat(56)}${c.reset}`);
    for (let i = 0; i < triage.topThree.length; i++) {
      const f = triage.topThree[i];
      const sevTag = `${severityColor(f.severity)}${f.severity.toUpperCase()}${c.reset}`;
      const loc = `${f.location.file}${f.location.startLine ? `:${f.location.startLine}` : ''}`;
      console.log(`  ${c.bold}${i + 1}.${c.reset} ${sevTag} ${f.title}`);
      console.log(`     ${c.dim}${loc}${c.reset}`);
      if (f.suggestedFix) {
        console.log(`     ${c.dim}Fix: ${f.suggestedFix}${c.reset}`);
      }
    }
    console.log('');
  }

  // Symptoms: "This is why you're experiencing..."
  const symptoms = diagnoseSymptoms(findings);
  if (symptoms.length > 0) {
    console.log(`${c.bold}${c.cyan}Why You're Experiencing Problems${c.reset}`);
    console.log(`${c.dim}${'─'.repeat(56)}${c.reset}`);
    for (const s of symptoms.slice(0, 5)) {
      console.log(`  ${s.icon}  ${c.bold}${s.headline}${c.reset} ${c.dim}(${s.findings.length} cause${s.findings.length > 1 ? 's' : ''})${c.reset}`);
      console.log(`     ${c.dim}${s.explanation.slice(0, 100)}${s.explanation.length > 100 ? '...' : ''}${c.reset}`);
    }
    if (symptoms.length > 5) {
      console.log(`  ${c.dim}...and ${symptoms.length - 5} more symptoms (see HTML report for full details)${c.reset}`);
    }
    console.log('');
  }

  // Category scores
  console.log(`${c.bold}Category Scores${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(56)}${c.reset}`);
  for (const cat of scores) {
    const nameCol = cat.categoryName.padEnd(48);
    const scoreStr = `${cat.score}/${cat.maxScore}`;
    console.log(`  ${nameCol} ${bar(cat.score, cat.maxScore, 12)} ${scoreStr}`);
  }
  console.log('');

  // Gates
  const failedGates = gates.filter(g => g.status === 'fail');
  if (failedGates.length > 0) {
    console.log(`${c.bold}${c.red}Failed Gates${c.reset}`);
    console.log(`${c.dim}${'─'.repeat(56)}${c.reset}`);
    for (const gate of failedGates) {
      console.log(`  ${c.red}✕${c.reset} ${gate.label}${gate.reason ? ` ${c.dim}— ${gate.reason}${c.reset}` : ''}`);
    }
    console.log('');
  }

  const passedGates = gates.filter(g => g.status === 'pass');
  if (passedGates.length > 0) {
    console.log(`${c.bold}Passed Gates${c.reset}`);
    for (const gate of passedGates) {
      console.log(`  ${c.green}✓${c.reset} ${gate.label}`);
    }
    console.log('');
  }

  // Findings
  const openFindings = findings.filter(f => f.status === 'open');
  if (openFindings.length > 0) {
    console.log(`${c.bold}Findings (${openFindings.length})${c.reset}`);
    console.log(`${c.dim}${'─'.repeat(56)}${c.reset}`);

    // Group by severity
    const bySeverity = ['critical', 'high', 'medium', 'low', 'info'] as const;
    for (const sev of bySeverity) {
      const sevFindings = openFindings.filter(f => f.severity === sev);
      if (sevFindings.length === 0) continue;

      for (const f of sevFindings) {
        const sevTag = `${severityColor(f.severity)}${f.severity.toUpperCase()}${c.reset}`;
        const confTag = `${c.dim}[${f.confidence}]${c.reset}`;
        console.log(`  ${sevTag} ${confTag} ${f.title}`);
        console.log(`    ${c.dim}${f.ruleId}${c.reset}  ${f.location.file}${f.location.startLine ? `:${f.location.startLine}` : ''}`);
        console.log(`    ${f.summary}`);
        if (f.codeSnippet) {
          console.log('');
          for (const line of f.codeSnippet.split('\n')) {
            const isHighlighted = line.startsWith('>');
            console.log(`    ${isHighlighted ? c.yellow : c.dim}${line}${c.reset}`);
          }
          console.log('');
        }
        if (f.evidenceRefs && f.evidenceRefs.length > 0) {
          for (const ref of f.evidenceRefs) {
            console.log(`    ${c.dim}↳ ${ref}${c.reset}`);
          }
        }
        if (f.suggestedFix) {
          console.log(`    ${c.dim}Fix: ${f.suggestedFix}${c.reset}`);
        }
        console.log('');
      }
    }
  }

  // Recommendation
  console.log(`${c.dim}${'─'.repeat(56)}${c.reset}`);
  console.log(`${c.bold}Recommendation:${c.reset} ${summary.recommendation}`);

  if (summary.launchBlockers.length > 0) {
    console.log('');
    console.log(`${c.bold}${c.red}Launch Blockers:${c.reset}`);
    for (const blocker of summary.launchBlockers) {
      console.log(`  ${c.red}■${c.reset} ${blocker}`);
    }
  }

  console.log('');
}

export function exportJson(report: AuditReport, outputDir: string): string {
  const path = join(outputDir, `flaw-report-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}

export function exportMarkdown(report: AuditReport, outputDir: string): string {
  const { summary, scores, smellIndex, findings, gates } = report;
  const lines: string[] = [];

  lines.push(`# FLAW — Flow Logic Audit Watch Report`);
  lines.push('');
  lines.push(`**Project:** ${report.project.name}`);
  lines.push(`**Score:** ${summary.totalScore}/100 — ${summary.rating.replace(/-/g, ' ')}`);
  lines.push(`**Status:** ${summary.status.toUpperCase()}`);
  lines.push(`**AI Smell Index:** ${smellIndex.score}/${smellIndex.maxScore} (${smellIndex.level})`);
  lines.push(`**Issues:** ${summary.criticalCount} critical · ${summary.highCount} high · ${summary.mediumCount} medium · ${summary.lowCount} low`);
  lines.push('');

  lines.push('## Category Scores');
  lines.push('');
  lines.push('| Category | Score | Status |');
  lines.push('|----------|-------|--------|');
  for (const cat of scores) {
    lines.push(`| ${cat.categoryName} | ${cat.score}/${cat.maxScore} | ${cat.status} |`);
  }
  lines.push('');

  const failedGates = gates.filter(g => g.status === 'fail');
  if (failedGates.length > 0) {
    lines.push('## Failed Gates');
    lines.push('');
    for (const gate of failedGates) {
      lines.push(`- **${gate.label}** — ${gate.reason || 'Failed'}`);
    }
    lines.push('');
  }

  const openFindings = findings.filter(f => f.status === 'open');
  if (openFindings.length > 0) {
    lines.push('## Findings');
    lines.push('');
    for (const f of openFindings) {
      lines.push(`### ${f.severity.toUpperCase()}: ${f.title}`);
      lines.push('');
      lines.push(`**Rule:** ${f.ruleId} | **Confidence:** ${f.confidence} | **Labels:** ${f.labels.join(', ')}`);
      lines.push('');
      lines.push(`**Location:** \`${f.location.file}${f.location.startLine ? `:${f.location.startLine}` : ''}\``);
      lines.push('');
      lines.push(f.summary);
      lines.push('');
      if (f.codeSnippet) {
        lines.push('```');
        lines.push(f.codeSnippet);
        lines.push('```');
        lines.push('');
      }
      if (f.evidenceRefs && f.evidenceRefs.length > 0) {
        lines.push('**Evidence:**');
        for (const ref of f.evidenceRefs) {
          lines.push(`- \`${ref}\``);
        }
        lines.push('');
      }
      if (f.suggestedFix) {
        lines.push(`**Fix:** ${f.suggestedFix}`);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }
  }

  lines.push(`## Recommendation`);
  lines.push('');
  lines.push(summary.recommendation);
  lines.push('');
  lines.push(`---`);
  lines.push(`*Generated by FLAW at ${report.generatedAt}*`);

  const path = join(outputDir, `flaw-report-${Date.now()}.md`);
  writeFileSync(path, lines.join('\n'));
  return path;
}
