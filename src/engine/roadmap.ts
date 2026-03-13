// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
/**
 * Production Readiness Roadmap
 * Generates a phased, prioritized plan to get code production-ready.
 */

import type { Finding, CategoryScore, TriageResult, Gate } from '../types/index.js';
import { getExplanation } from './explain.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RoadmapPhase {
  phase: number;
  title: string;
  description: string;
  effort: string;
  items: RoadmapItem[];
}

export interface RoadmapItem {
  title: string;
  file: string;
  ruleId: string;
  severity: string;
  explanation: string;
  steps: string[];
  prompt: string;
}

export interface Roadmap {
  phases: RoadmapPhase[];
  estimatedPhases: number;
  summary: string;
}

export function generateRoadmap(
  findings: Finding[],
  scores: CategoryScore[],
  gates: Gate[],
  triage?: TriageResult,
): Roadmap {
  const open = findings.filter(f => f.status === 'open');

  // Deduplicate findings by ruleId + file
  const seen = new Set<string>();
  const deduped: Finding[] = [];
  for (const f of open) {
    const key = `${f.ruleId}:${f.location.file}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(f); }
  }

  // Phase 1: Security & Secrets — things that can get you hacked TODAY
  const phase1Findings = deduped.filter(f =>
    f.categoryId === 'SA' || f.ruleId === 'FK-SA-SECRET-001'
  );

  // Phase 2: Broken Wiring — things that make the app visibly broken
  const phase2Findings = deduped.filter(f =>
    !phase1Findings.includes(f) && (
      f.ruleId.startsWith('FK-FW-WIRE') ||
      f.ruleId.startsWith('FK-FW-BTN') ||
      f.ruleId.startsWith('FK-FW-FORM') ||
      f.ruleId.startsWith('FK-BE-ENDPOINT') ||
      f.ruleId.startsWith('FK-BE-SHAPE') ||
      f.ruleId.startsWith('FK-FR-STUB') ||
      f.ruleId.startsWith('FK-BE-DEAD') ||
      f.severity === 'critical'
    )
  );

  // Phase 3: Data & Validation — things that corrupt data or allow abuse
  const phase3Findings = deduped.filter(f =>
    !phase1Findings.includes(f) && !phase2Findings.includes(f) && (
      f.categoryId === 'VB' ||
      f.categoryId === 'DM' ||
      f.ruleId.startsWith('FK-EH-SILENT') ||
      f.ruleId.startsWith('FK-EH-FALLBACK') ||
      f.ruleId.startsWith('FK-EH-FALSESUCCESS')
    )
  );

  // Phase 4: Reliability & Quality — things that cause random failures
  const phase4Findings = deduped.filter(f =>
    !phase1Findings.includes(f) && !phase2Findings.includes(f) && !phase3Findings.includes(f) && (
      f.categoryId === 'EH' ||
      f.ruleId.startsWith('FK-FR-') ||
      f.ruleId.startsWith('FK-FW-EFFECT') ||
      f.ruleId.startsWith('FK-FW-ASYNC') ||
      f.ruleId.startsWith('FK-FW-STATE')
    )
  );

  // Phase 5: Polish — maintainability, tests, docs
  const assigned = new Set([...phase1Findings, ...phase2Findings, ...phase3Findings, ...phase4Findings]);
  const phase5Findings = deduped.filter(f => !assigned.has(f));

  function toItems(findings: Finding[]): RoadmapItem[] {
    return findings.slice(0, 15).map(f => {
      const ex = getExplanation(f.ruleId);
      return {
        title: f.title,
        file: `${f.location.file}${f.location.startLine ? ':' + f.location.startLine : ''}`,
        ruleId: f.ruleId,
        severity: f.severity,
        explanation: ex?.what || f.summary,
        steps: ex?.steps || (f.suggestedFix ? [f.suggestedFix] : []),
        prompt: ex?.prompt || f.suggestedFix || `Fix: ${f.title}`,
      };
    });
  }

  const phases: RoadmapPhase[] = [];

  if (phase1Findings.length > 0) {
    phases.push({
      phase: 1,
      title: 'Security First',
      description: 'These issues can get you hacked or leak data right now. Fix before anything else.',
      effort: phase1Findings.length <= 3 ? '30 minutes' : phase1Findings.length <= 10 ? '1-2 hours' : '2-4 hours',
      items: toItems(phase1Findings),
    });
  }

  if (phase2Findings.length > 0) {
    phases.push({
      phase: phases.length + 1,
      title: 'Fix What\'s Broken',
      description: 'Buttons that don\'t work, pages that show blank, features that are just stubs. These are the things users notice immediately.',
      effort: phase2Findings.length <= 5 ? '1-2 hours' : phase2Findings.length <= 15 ? '3-5 hours' : '1-2 days',
      items: toItems(phase2Findings),
    });
  }

  if (phase3Findings.length > 0) {
    phases.push({
      phase: phases.length + 1,
      title: 'Protect Your Data',
      description: 'Input validation, error handling, and data integrity. These prevent data corruption and abuse.',
      effort: phase3Findings.length <= 5 ? '1-2 hours' : phase3Findings.length <= 15 ? '3-5 hours' : '1-2 days',
      items: toItems(phase3Findings),
    });
  }

  if (phase4Findings.length > 0) {
    phases.push({
      phase: phases.length + 1,
      title: 'Make It Reliable',
      description: 'Error handling, async issues, and state management. These cause the random crashes and "it worked yesterday" bugs.',
      effort: phase4Findings.length <= 5 ? '1-2 hours' : phase4Findings.length <= 15 ? '3-5 hours' : '1-2 days',
      items: toItems(phase4Findings),
    });
  }

  if (phase5Findings.length > 0) {
    phases.push({
      phase: phases.length + 1,
      title: 'Polish & Maintain',
      description: 'Code quality, tests, documentation. These make the codebase sustainable long-term.',
      effort: phase5Findings.length <= 5 ? '1-2 hours' : phase5Findings.length <= 15 ? '3-5 hours' : '1-2 days',
      items: toItems(phase5Findings),
    });
  }

  const failedGates = gates.filter(g => g.status === 'fail');
  const totalItems = deduped.length;

  let summary = '';
  if (totalItems === 0) {
    summary = 'Your project looks production-ready. No critical issues found.';
  } else if (phase1Findings.length > 0) {
    summary = `Start with Phase 1 (Security). You have ${phase1Findings.length} security issue${phase1Findings.length > 1 ? 's' : ''} that must be fixed before anything else. ${failedGates.length > 0 ? `${failedGates.length} launch gate${failedGates.length > 1 ? 's' : ''} currently failing.` : ''}`;
  } else if (phase2Findings.length > 0) {
    summary = `No security issues — start with Phase 1 (Fix What's Broken). ${phase2Findings.length} features are visibly broken and need immediate attention.`;
  } else {
    summary = `Core features work. Focus on data protection and reliability to harden the app.`;
  }

  return {
    phases,
    estimatedPhases: phases.length,
    summary,
  };
}

/**
 * Export roadmap as markdown
 */
export function exportRoadmap(roadmap: Roadmap, outputDir: string): string {

  let md = `# Production Readiness Roadmap\n\n`;
  md += `> ${roadmap.summary}\n\n`;
  md += `**${roadmap.estimatedPhases} phases** to production-ready.\n\n---\n\n`;

  for (const phase of roadmap.phases) {
    md += `## Phase ${phase.phase}: ${phase.title}\n\n`;
    md += `${phase.description}\n\n`;
    md += `**Estimated effort:** ${phase.effort} | **${phase.items.length} items**\n\n`;

    for (let i = 0; i < phase.items.length; i++) {
      const item = phase.items[i];
      md += `### ${i + 1}. ${item.title}\n\n`;
      md += `**File:** \`${item.file}\` | **Severity:** ${item.severity}\n\n`;
      md += `${item.explanation}\n\n`;
      if (item.steps.length > 0) {
        md += `**Steps:**\n`;
        for (const step of item.steps) {
          md += `- [ ] ${step}\n`;
        }
        md += `\n`;
      }
      md += `**AI Prompt:**\n\`\`\`\n${item.prompt}\n\`\`\`\n\n`;
    }

    md += `---\n\n`;
  }

  const path = join(outputDir, 'flaw-roadmap.md');
  writeFileSync(path, md);
  return path;
}
