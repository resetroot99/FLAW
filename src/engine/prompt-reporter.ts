// AI-prompt output — generates a structured prompt for AI coding tools
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditReport, TriageResult, Finding } from '../types/index.js';

function renderIssue(f: Finding, index: number): string {
  const lines: string[] = [];
  const loc = `${f.location.file}${f.location.startLine ? `:${f.location.startLine}` : ''}`;

  lines.push(`### Issue ${index}: ${f.title}`);
  lines.push(`- **File:** \`${loc}\``);
  lines.push(`- **Rule:** ${f.ruleId} (severity: ${f.severity}, confidence: ${f.confidence})`);
  lines.push(`- **Problem:** ${f.summary}`);

  if (f.codeSnippet) {
    // Trim snippet to max 5 lines for prompt brevity
    const snippetLines = f.codeSnippet.split('\n');
    const trimmed = snippetLines.length > 7
      ? [...snippetLines.slice(0, 5), '  ...'].join('\n')
      : f.codeSnippet;
    lines.push('- **Current code:**');
    lines.push('```');
    lines.push(trimmed);
    lines.push('```');
  }

  if (f.suggestedFix) {
    lines.push(`- **Suggested approach:** ${f.suggestedFix}`);
  }

  if (f.evidenceRefs && f.evidenceRefs.length > 0) {
    lines.push(`- **Related:** ${f.evidenceRefs.slice(0, 3).join(', ')}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function generatePrompt(report: AuditReport, triage: TriageResult): string {
  const { summary, project } = report;
  const lines: string[] = [];

  lines.push(`I need help fixing issues found by FLAW (code auditor) in my project.`);
  lines.push('');

  lines.push('## Project Context');
  lines.push(`- **Project:** ${project.name}`);
  if (project.framework) lines.push(`- **Framework:** ${project.framework}`);
  lines.push(`- **Score:** ${summary.totalScore}/100 (${summary.rating.replace(/-/g, ' ')})`);
  lines.push(`- **Issues:** ${summary.criticalCount} critical, ${summary.highCount} high, ${summary.mediumCount} medium`);
  lines.push('');

  lines.push('## Issues to Fix (ordered by priority)');
  lines.push('');

  // Cap at 10 most important findings to keep prompt focused
  const allFindings = triage.groups.flatMap(g => g.findings);
  const capped = allFindings.slice(0, 10);

  for (let i = 0; i < capped.length; i++) {
    lines.push(renderIssue(capped[i], i + 1));
  }

  if (allFindings.length > 10) {
    lines.push(`> ${allFindings.length - 10} additional findings omitted. Run \`flaw --fixes\` for the full list.`);
    lines.push('');
  }

  lines.push('## Constraints');
  lines.push('- Fix each issue minimally — don\'t refactor surrounding code');
  lines.push('- Maintain existing type signatures and interfaces');
  lines.push('- Do not introduce new dependencies');
  lines.push('- Each fix should be in its own code block with the file path');
  lines.push('');

  return lines.join('\n');
}

export function exportPrompt(report: AuditReport, triage: TriageResult, outputDir: string): string {
  const prompt = generatePrompt(report, triage);
  const path = join(outputDir, 'flaw-prompt.md');
  writeFileSync(path, prompt);
  return path;
}
