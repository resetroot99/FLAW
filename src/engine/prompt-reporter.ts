// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
// AI-prompt output — generates structured prompts for AI coding tools
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditReport, TriageResult, Finding, CategoryScore } from '../types/index.js';

export type PromptStrategy = 'fix' | 'refactor' | 'strip' | 'realign' | 'verify';

function renderIssue(f: Finding, index: number): string {
  const lines: string[] = [];
  const loc = `${f.location.file}${f.location.startLine ? `:${f.location.startLine}` : ''}`;

  lines.push(`### Issue ${index}: ${f.title}`);
  lines.push(`- **File:** \`${loc}\``);
  lines.push(`- **Rule:** ${f.ruleId} (severity: ${f.severity}, confidence: ${f.confidence})`);
  lines.push(`- **Problem:** ${f.summary}`);

  if (f.codeSnippet) {
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

function projectContext(report: AuditReport): string[] {
  const { summary, project } = report;
  const lines: string[] = [];
  lines.push('## Project Context');
  lines.push(`- **Project:** ${project.name}`);
  if (project.framework) lines.push(`- **Framework:** ${project.framework}`);
  lines.push(`- **Score:** ${summary.totalScore}/100 (${summary.rating.replace(/-/g, ' ')})`);
  lines.push(`- **Issues:** ${summary.criticalCount} critical, ${summary.highCount} high, ${summary.mediumCount} medium`);

  // Show which categories are healthy vs broken
  const healthy = report.scores.filter(s => s.score / s.maxScore >= 0.7);
  const broken = report.scores.filter(s => s.score / s.maxScore < 0.3);
  if (healthy.length > 0) {
    lines.push(`- **Healthy areas:** ${healthy.map(s => s.categoryName).join(', ')}`);
  }
  if (broken.length > 0) {
    lines.push(`- **Broken areas:** ${broken.map(s => `${s.categoryName} (${s.score}/${s.maxScore})`).join(', ')}`);
  }

  // AI fingerprint info
  if (report.summary.fingerprint && report.summary.fingerprint.length > 0) {
    const fps = report.summary.fingerprint.map(f => `${f.tool} (${f.confidence}%)`).join(', ');
    lines.push(`- **AI fingerprints detected:** ${fps}`);
  }

  lines.push('');
  return lines;
}

// --- Strategy: Fix (original behavior) ---
function generateFixPrompt(report: AuditReport, triage: TriageResult): string {
  const lines: string[] = [];
  lines.push(`I need help fixing issues found by FLAW (code auditor) in my project.`);
  lines.push('');
  lines.push(...projectContext(report));

  lines.push('## Issues to Fix (ordered by priority)');
  lines.push('');

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

// --- Strategy: Refactor ---
function generateRefactorPrompt(report: AuditReport, triage: TriageResult): string {
  const lines: string[] = [];
  lines.push('I need help refactoring my codebase. A FLAW audit found deep structural problems that can\'t be fixed one-by-one — the code needs to be reorganized.');
  lines.push('');
  lines.push(...projectContext(report));

  // Identify the biggest structural problems
  const allFindings = triage.groups.flatMap(g => g.findings);
  const sizeFindings = allFindings.filter(f => f.ruleId.includes('SIZE') || f.ruleId.includes('DUP') || f.ruleId.includes('DEAD'));
  const errorFindings = allFindings.filter(f => f.ruleId.includes('EH-') || f.ruleId.includes('SILENT'));
  const smellFindings = allFindings.filter(f => f.ruleId.includes('SM-') || f.labels?.includes('Overengineered'));

  lines.push('## What needs refactoring');
  lines.push('');

  if (sizeFindings.length > 0) {
    lines.push('### Large / duplicated files');
    for (const f of sizeFindings.slice(0, 5)) {
      lines.push(`- \`${f.location.file}\`: ${f.title}`);
    }
    lines.push('');
  }

  if (errorFindings.length > 0) {
    lines.push('### Error handling that swallows failures');
    for (const f of errorFindings.slice(0, 5)) {
      lines.push(`- \`${f.location.file}:${f.location.startLine || ''}\`: ${f.title}`);
    }
    lines.push('');
  }

  if (smellFindings.length > 0) {
    lines.push('### AI-generated code smells');
    for (const f of smellFindings.slice(0, 5)) {
      lines.push(`- \`${f.location.file}\`: ${f.title}`);
    }
    lines.push('');
  }

  // Show the 0-score categories as focus areas
  const zeroCategories = report.scores.filter(s => s.score === 0);
  if (zeroCategories.length > 0) {
    lines.push('### Categories scoring 0 (need complete rework)');
    for (const cat of zeroCategories) {
      lines.push(`- **${cat.categoryName}** (0/${cat.maxScore})`);
    }
    lines.push('');
  }

  lines.push('## Refactoring instructions');
  lines.push('- Break files over 500 lines into focused modules by responsibility');
  lines.push('- Replace every `except: pass` / `catch {}` with proper error logging');
  lines.push('- Remove dead code, unused imports, and stub functions that do nothing');
  lines.push('- Consolidate duplicated logic into shared utilities');
  lines.push('- Remove cargo-cult abstractions that add complexity without value');
  lines.push('- Keep all existing functionality working — this is restructuring, not rewriting');
  lines.push('- Show me a file-by-file plan before making changes');
  lines.push('');

  return lines.join('\n');
}

// --- Strategy: Strip UI ---
function generateStripPrompt(report: AuditReport, triage: TriageResult): string {
  const lines: string[] = [];
  lines.push('My app has a UI that promises features which don\'t actually work. I need help stripping it back to only what\'s real and functional.');
  lines.push('');
  lines.push(...projectContext(report));

  const allFindings = triage.groups.flatMap(g => g.findings);

  // Find broken UI / fake flows
  const fakeFlows = allFindings.filter(f =>
    f.labels?.includes('Fake Flow') ||
    f.labels?.includes('Dead Control') ||
    f.labels?.includes('Incomplete') ||
    f.ruleId.includes('FW-BTN') ||
    f.ruleId.includes('FW-FORM') ||
    f.ruleId.includes('FR-') ||
    f.ruleId.includes('STUB') ||
    f.ruleId.includes('EMPTY')
  );

  const fakeAdapters = allFindings.filter(f =>
    f.title.toLowerCase().includes('fake') ||
    f.title.toLowerCase().includes('hallucinated') ||
    f.title.toLowerCase().includes('placeholder')
  );

  lines.push('## What\'s fake or broken in the UI');
  lines.push('');

  if (fakeFlows.length > 0) {
    lines.push('### Dead controls and incomplete features');
    for (const f of fakeFlows.slice(0, 8)) {
      lines.push(`- \`${f.location.file}\`: ${f.title}`);
    }
    lines.push('');
  }

  if (fakeAdapters.length > 0) {
    lines.push('### Fake integrations and hallucinated references');
    for (const f of fakeAdapters.slice(0, 8)) {
      lines.push(`- \`${f.location.file}\`: ${f.title}`);
    }
    lines.push('');
  }

  // Show what IS working
  const healthy = report.scores.filter(s => s.score / s.maxScore >= 0.7);
  if (healthy.length > 0) {
    lines.push('## What\'s actually working (keep these)');
    for (const cat of healthy) {
      lines.push(`- **${cat.categoryName}** — ${cat.score}/${cat.maxScore}`);
    }
    lines.push('');
  }

  lines.push('## Instructions');
  lines.push('- Remove UI elements (buttons, menu items, pages) that link to features with no working backend');
  lines.push('- Remove routes and navigation entries for stub/empty pages');
  lines.push('- Remove fake integration adapters that don\'t connect to anything real');
  lines.push('- Remove placeholder config values that look real but aren\'t (fake API keys, dummy URLs)');
  lines.push('- Keep all genuinely functional features intact');
  lines.push('- Update navigation so it only shows what actually works');
  lines.push('- The goal is an app that\'s smaller but 100% honest — every button does what it says');
  lines.push('- List every file you\'ll modify and what you\'ll remove before making changes');
  lines.push('');

  return lines.join('\n');
}

// --- Strategy: Realign ---
function generateRealignPrompt(report: AuditReport, triage: TriageResult): string {
  const lines: string[] = [];
  lines.push('My project has drifted from its original purpose. I need a plan to get it back on track to deliver a functional, realistic, and aligned application.');
  lines.push('');
  lines.push(...projectContext(report));

  const allFindings = triage.groups.flatMap(g => g.findings);

  // Categorize the damage
  const securityIssues = allFindings.filter(f => f.ruleId.includes('SA-'));
  const errorIssues = allFindings.filter(f => f.ruleId.includes('EH-'));
  const validationIssues = allFindings.filter(f => f.ruleId.includes('VB-'));
  const maintIssues = allFindings.filter(f => f.ruleId.includes('MH-'));

  lines.push('## Current state assessment');
  lines.push('');

  const broken = report.scores.filter(s => s.score / s.maxScore < 0.3);
  const partial = report.scores.filter(s => s.score / s.maxScore >= 0.3 && s.score / s.maxScore < 0.7);
  const healthy = report.scores.filter(s => s.score / s.maxScore >= 0.7);

  if (healthy.length > 0) {
    lines.push('### Working well');
    for (const cat of healthy) lines.push(`- ${cat.categoryName}: ${cat.score}/${cat.maxScore}`);
    lines.push('');
  }
  if (partial.length > 0) {
    lines.push('### Needs work');
    for (const cat of partial) lines.push(`- ${cat.categoryName}: ${cat.score}/${cat.maxScore}`);
    lines.push('');
  }
  if (broken.length > 0) {
    lines.push('### Broken / missing');
    for (const cat of broken) lines.push(`- ${cat.categoryName}: ${cat.score}/${cat.maxScore}`);
    lines.push('');
  }

  // AI smell summary
  if (report.smellIndex.score >= 7) {
    lines.push('### AI code quality concerns');
    lines.push(`The AI Smell Index is ${report.smellIndex.score}/10 (${report.smellIndex.level}). Key issues:`);
    for (const smell of report.smellIndex.smells.slice(0, 6)) {
      lines.push(`- ${smell.label} (x${smell.count})`);
    }
    lines.push('');
  }

  lines.push('## Realignment plan');
  lines.push('');
  lines.push('Create a phased plan to get this project functional and honest:');
  lines.push('');
  lines.push('### Phase 1: Stabilize (make what exists actually work)');
  if (securityIssues.length > 0) lines.push(`- Fix ${securityIssues.length} security/auth issues — every route must check authentication`);
  if (errorIssues.length > 0) lines.push(`- Fix ${errorIssues.length} error handling issues — no silent failures, log everything`);
  if (validationIssues.length > 0) lines.push(`- Fix ${validationIssues.length} validation issues — all user input must be bounded and validated`);
  lines.push('- Remove placeholder/fake config values and replace with real env vars');
  lines.push('');

  lines.push('### Phase 2: Cut the dead weight');
  lines.push('- Remove features that exist in the UI but don\'t work on the backend');
  lines.push('- Remove hallucinated utility functions and fake integrations');
  lines.push('- Remove dead code and unused files');
  lines.push('');

  lines.push('### Phase 3: Rebuild what matters');
  if (broken.length > 0) {
    lines.push('Focus on these broken categories:');
    for (const cat of broken) {
      lines.push(`- **${cat.categoryName}** (${cat.score}/${cat.maxScore}) — needs implementation from scratch`);
    }
  }
  lines.push('');

  lines.push('### Phase 4: Verify');
  lines.push('- Every feature in the navigation must have a working end-to-end flow');
  lines.push('- Every API endpoint must have auth, validation, and error handling');
  lines.push('- Run FLAW again — target score: 75+');
  lines.push('');

  lines.push('## Instructions');
  lines.push('- Start by telling me which features are worth keeping based on the codebase');
  lines.push('- Propose which features to cut entirely vs fix');
  lines.push('- Give me a concrete file-by-file action plan for Phase 1');
  lines.push('- Do NOT add new features — focus only on making existing ones real');
  lines.push('- The goal is an app that scores 75+ on FLAW with zero fake flows');
  lines.push('');

  return lines.join('\n');
}

// --- Strategy: Verify Output ---
function generateVerifyPrompt(report: AuditReport, triage: TriageResult): string {
  const lines: string[] = [];
  lines.push('My app\'s APIs and outputs don\'t match what the frontend expects. I need help auditing and fixing the contract between frontend and backend so every screen shows real, correct data.');
  lines.push('');
  lines.push(...projectContext(report));

  const allFindings = triage.groups.flatMap(g => g.findings);

  // Find API/data contract issues
  const wiringIssues = allFindings.filter(f =>
    f.ruleId.includes('CW-') || f.ruleId.includes('BI-') ||
    f.ruleId.includes('DM-') || f.ruleId.includes('FR-WIRE')
  );
  const validationIssues = allFindings.filter(f => f.ruleId.includes('VB-'));
  const schemaIssues = allFindings.filter(f =>
    f.labels?.includes('Schema Drift') ||
    f.title.toLowerCase().includes('field') ||
    f.title.toLowerCase().includes('schema') ||
    f.title.toLowerCase().includes('unbounded')
  );
  const fakeData = allFindings.filter(f =>
    f.title.toLowerCase().includes('placeholder') ||
    f.title.toLowerCase().includes('hardcoded') ||
    f.title.toLowerCase().includes('fake')
  );

  lines.push('## API & output issues found');
  lines.push('');

  if (wiringIssues.length > 0) {
    lines.push('### Frontend-backend wiring mismatches');
    for (const f of wiringIssues.slice(0, 8)) {
      lines.push(`- \`${f.location.file}:${f.location.startLine || ''}\`: ${f.title}`);
    }
    lines.push('');
  }

  if (schemaIssues.length > 0) {
    lines.push('### Schema and data model issues');
    for (const f of schemaIssues.slice(0, 6)) {
      lines.push(`- \`${f.location.file}\`: ${f.title}`);
    }
    lines.push('');
  }

  if (validationIssues.length > 0) {
    lines.push('### Missing validation');
    for (const f of validationIssues.slice(0, 6)) {
      lines.push(`- \`${f.location.file}\`: ${f.title}`);
    }
    lines.push('');
  }

  if (fakeData.length > 0) {
    lines.push('### Fake/placeholder data still in production code');
    for (const f of fakeData.slice(0, 6)) {
      lines.push(`- \`${f.location.file}\`: ${f.title}`);
    }
    lines.push('');
  }

  lines.push('## Instructions');
  lines.push('- For each API endpoint, verify the response shape matches what the frontend component expects');
  lines.push('- Check that every field the frontend reads actually exists in the API response');
  lines.push('- Check that data types match (e.g., frontend expects an array but backend sends an object)');
  lines.push('- Replace any hardcoded/placeholder values with real data from the database or environment');
  lines.push('- Add input validation on every endpoint — reject malformed requests with clear error messages');
  lines.push('- Add response validation — every API should return a consistent shape (even on errors)');
  lines.push('- Add size limits to all unbounded fields (text inputs, file uploads, array lengths)');
  lines.push('- Show me each API endpoint with its current response shape vs what the frontend expects');
  lines.push('- The goal is: every screen displays real data, every form submission works end-to-end');
  lines.push('');

  return lines.join('\n');
}

// --- Public API ---

export function generatePrompt(report: AuditReport, triage: TriageResult, strategy: PromptStrategy = 'fix'): string {
  switch (strategy) {
    case 'refactor': return generateRefactorPrompt(report, triage);
    case 'strip': return generateStripPrompt(report, triage);
    case 'realign': return generateRealignPrompt(report, triage);
    case 'verify': return generateVerifyPrompt(report, triage);
    case 'fix':
    default: return generateFixPrompt(report, triage);
  }
}

export const PROMPT_STRATEGIES: { id: PromptStrategy; label: string; description: string }[] = [
  { id: 'fix', label: 'Fix Issues', description: 'Fix the top priority issues one by one' },
  { id: 'refactor', label: 'Refactor', description: 'Restructure and clean up the codebase' },
  { id: 'strip', label: 'Strip Fake UI', description: 'Remove broken features, keep only what works' },
  { id: 'realign', label: 'Realign Project', description: 'Get the project back on track to deliver' },
  { id: 'verify', label: 'Verify Output', description: 'Ensure APIs return what the frontend expects' },
];

export function exportPrompt(report: AuditReport, triage: TriageResult, outputDir: string, strategy: PromptStrategy = 'fix'): string {
  const prompt = generatePrompt(report, triage, strategy);
  const suffix = strategy === 'fix' ? '' : `-${strategy}`;
  const path = join(outputDir, `flaw-prompt${suffix}.md`);
  writeFileSync(path, prompt);
  return path;
}
