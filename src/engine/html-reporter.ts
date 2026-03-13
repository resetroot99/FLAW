// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
import type { AuditReport, Finding, CategoryScore, SmellIndex, Gate, TriageResult, AnalyzerContext } from '../types/index.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePrompt } from './prompt-reporter.js';
import { getExplanation, getFindingPrompt } from './explain.js';
import { diagnoseSymptoms } from './symptoms.js';
import { generateRoadmap } from './roadmap.js';
import { generateAgentRules } from './rules-generator.js';
import { analyzePromiseVsReality, type PromiseReality } from './promise-reality.js';
import { generatePurposePlan, type PurposePlan } from './purpose-plan.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function severityClass(severity: string): string {
  return `tag-${severity}`;
}

function statusBadgeClass(status: string): string {
  if (status === 'pass') return 'decision-ship';
  if (status === 'conditional-pass') return 'decision-review';
  return 'decision-block';
}

function statusLabel(status: string): string {
  if (status === 'pass') return 'SHIP';
  if (status === 'conditional-pass') return 'REVIEW';
  return 'BLOCK';
}

function ratingLabel(rating: string): string {
  return rating.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function categoryBadgeColor(catId: string): string {
  const colors: Record<string, string> = {
    FR: '#6366f1', FW: '#f97316', BE: '#06b6d4', DM: '#8b5cf6',
    VB: '#ec4899', EH: '#f59e0b', SA: '#ef4444', MH: '#10b981',
    TV: '#3b82f6', DO: '#64748b',
  };
  return colors[catId] || '#666';
}

export function exportHtml(report: AuditReport, outputDir: string, triage?: TriageResult, scanCtx?: AnalyzerContext): string {
  const { summary, scores, smellIndex, findings, gates, project, audit } = report;
  const openFindings = findings.filter(f => f.status === 'open');
  const failedGates = gates.filter(g => g.status === 'fail');
  const passedGates = gates.filter(g => g.status === 'pass');

  // Group findings by category
  const findingsByCategory = new Map<string, Finding[]>();
  for (const f of openFindings) {
    const cat = findingsByCategory.get(f.categoryId) || [];
    cat.push(f);
    findingsByCategory.set(f.categoryId, cat);
  }

  const totalFindings = openFindings.length;
  const criticalFindings = openFindings.filter(f => f.severity === 'critical');
  const highFindings = openFindings.filter(f => f.severity === 'high');

  // Ship decision
  const shipDecision = statusLabel(summary.status);
  const shipClass = statusBadgeClass(summary.status);

  // Symptom diagnosis
  const symptoms = diagnoseSymptoms(findings);

  // Roadmap
  const roadmap = generateRoadmap(openFindings, report.scores, gates, triage);

  // Agent rules preview
  const agentRules = generateAgentRules(report);

  // Promise vs Reality + Purpose Plan
  let promiseReality: PromiseReality | null = null;
  let purposePlan: PurposePlan | null = null;
  if (scanCtx) {
    promiseReality = analyzePromiseVsReality(scanCtx, openFindings);
    if (promiseReality.claims.some(c => c.status !== 'implemented')) {
      purposePlan = generatePurposePlan(promiseReality, project.framework);
    }
  }

  // Root causes: top 3 findings by severity
  const topFindings = [...openFindings]
    .sort((a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
    })
    .slice(0, 3);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FLAW Report - ${escapeHtml(project.name)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg-primary: #ffffff;
      --bg-secondary: #fafafa;
      --bg-tertiary: #f5f5f5;
      --border: rgba(0, 0, 0, 0.1);
      --text-primary: #171717;
      --text-secondary: #525252;
      --text-muted: #a3a3a3;
      --accent: #3b82f6;
      --success: #22c55e;
      --danger: #ef4444;
      --warning: #f59e0b;
      --info: #3b82f6;
    }

    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.4;
      font-size: 12px;
    }

    .container { max-width: 1400px; margin: 0 auto; padding: 16px; }

    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 0; border-bottom: 1px solid var(--border); margin-bottom: 14px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-icon {
      width: 28px; height: 28px; background: var(--accent); border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; color: var(--bg-primary); font-size: 14px;
    }
    .brand-text { font-size: 16px; font-weight: 700; }
    .brand-subtitle { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
    .header-actions button {
      background: transparent; border: 1px solid var(--border); color: var(--text-secondary);
      padding: 6px 12px; border-radius: 6px; font-size: 11px; cursor: pointer;
      font-weight: 500; margin-left: 8px;
    }
    .header-actions button:hover { border-color: var(--accent); color: var(--accent); }

    .status-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; background: var(--bg-secondary); border: 1px solid var(--border);
      border-radius: 6px; margin-bottom: 10px;
    }
    .status-left { display: flex; align-items: center; gap: 12px; }
    .status-badge {
      width: 32px; height: 32px; border-radius: 50%; display: flex;
      align-items: center; justify-content: center; font-size: 16px; font-weight: 700;
    }
    .status-verified { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 2px solid var(--success); }
    .status-failed { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 2px solid var(--danger); }
    .status-warning { background: rgba(245, 158, 11, 0.15); color: var(--warning); border: 2px solid var(--warning); }
    .status-info h3 { font-size: 14px; font-weight: 600; margin-bottom: 2px; }
    .status-info p { font-size: 11px; color: var(--text-muted); }
    .status-meta { text-align: right; font-size: 11px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; }
    .status-meta div { margin-bottom: 2px; }

    .ship-decision {
      background: var(--bg-secondary); border: 1px solid var(--border);
      border-radius: 6px; padding: 10px 14px; margin-bottom: 10px;
    }
    .decision-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .decision-badge {
      padding: 4px 10px; border-radius: 4px; font-size: 11px;
      font-weight: 700; letter-spacing: 0.5px;
    }
    .decision-block { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid var(--danger); }
    .decision-review { background: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid var(--warning); }
    .decision-ship { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid var(--success); }
    .decision-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); }
    .decision-reason { font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; }
    .decision-action {
      font-size: 11px; color: var(--text-primary); font-weight: 500;
      padding: 6px 10px; background: rgba(255, 255, 255, 0.5);
      border-radius: 4px; border-left: 3px solid var(--accent);
    }

    .root-causes { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 14px; }
    .root-causes summary {
      padding: 8px 12px; cursor: pointer; font-size: 10px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-secondary); user-select: none;
    }
    .root-causes summary:hover { color: var(--accent); }
    .root-causes-list { padding: 10px; border-top: 1px solid var(--border); }
    .root-cause-item { margin-bottom: 8px; padding: 8px; background: rgba(0, 0, 0, 0.02); border-radius: 4px; }
    .root-cause-item:last-child { margin-bottom: 0; }
    .root-cause-header { font-size: 11px; font-weight: 600; color: var(--text-primary); margin-bottom: 2px; }
    .root-cause-tests { font-size: 10px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; }

    .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
    .metric {
      background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px;
      padding: 10px; text-align: center; cursor: pointer; transition: all 0.2s;
    }
    .metric:hover { border-color: var(--accent); transform: translateY(-1px); }
    .metric-label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); margin-bottom: 4px; }
    .metric-value { font-size: 24px; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: var(--accent); line-height: 1; }
    .metric-subtitle { font-size: 9px; color: var(--text-secondary); margin-top: 2px; }

    .grid { display: grid; grid-template-columns: 1fr 360px; gap: 14px; }
    .card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; margin-bottom: 14px; }
    .card-header {
      padding: 8px 12px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
    }
    .card-title { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-secondary); }
    .card-body { padding: 10px; }

    .timeline-lane {
      background: rgba(0, 0, 0, 0.02); border: 1px solid var(--border);
      border-radius: 5px; padding: 8px 10px; margin-bottom: 5px;
    }
    .lane-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .lane-badge {
      width: 20px; height: 20px; border-radius: 4px; display: flex;
      align-items: center; justify-content: center; font-weight: 700; font-size: 10px; color: white;
    }
    .lane-name { font-size: 12px; font-weight: 600; }
    .lane-stats { font-size: 10px; color: var(--text-muted); margin-left: auto; font-family: 'JetBrains Mono', monospace; }
    .lane-bar { height: 6px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden; }
    .lane-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }

    .smell-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .smell-item {
      padding: 8px 10px; background: rgba(0, 0, 0, 0.02); border-radius: 4px;
      display: flex; justify-content: space-between; align-items: center;
      font-size: 11px;
    }
    .smell-count { font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 12px; }

    .gate-item { padding: 8px 10px; display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .gate-icon { font-size: 14px; }
    .gate-pass .gate-icon { color: var(--success); }
    .gate-fail .gate-icon { color: var(--danger); }
    .gate-reason { font-size: 10px; color: var(--text-muted); margin-left: auto; }

    .forensic-panel { position: sticky; top: 20px; height: calc(100vh - 40px); display: flex; flex-direction: column; }
    .forensic-search {
      padding: 12px; background: var(--bg-tertiary); border-bottom: 1px solid var(--border);
      position: sticky; top: 0; z-index: 10;
    }
    .search-input {
      width: 100%; background: var(--bg-tertiary); border: 1px solid var(--border);
      border-radius: 6px; padding: 8px 10px; color: var(--text-primary);
      font-size: 11px; font-family: 'JetBrains Mono', monospace;
    }
    .search-input:focus { outline: none; border-color: var(--accent); }
    .filter-row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .filter-chip {
      padding: 4px 8px; font-size: 9px; font-weight: 600; border-radius: 4px;
      border: 1px solid var(--border); background: transparent; color: var(--text-secondary);
      cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; transition: all 0.2s;
    }
    .filter-chip:hover { background: rgba(0, 0, 0, 0.05); }
    .filter-chip.active { background: rgba(59, 130, 246, 0.15); border-color: var(--accent); color: var(--accent); }
    .forensic-list { flex: 1; overflow-y: auto; padding: 8px; }

    .forensic-item {
      padding: 8px 10px; margin-bottom: 4px; border-radius: 5px; cursor: pointer;
      border-left: 2px solid transparent; background: rgba(0, 0, 0, 0.02); transition: all 0.2s;
    }
    .forensic-item:hover { background: rgba(0, 0, 0, 0.05); border-left-color: var(--accent); }
    .forensic-item.selected { background: rgba(59, 130, 246, 0.1); border-left-color: var(--accent); }
    .forensic-item.sev-critical { border-left-color: var(--danger); }
    .forensic-item.sev-high { border-left-color: var(--warning); }

    .forensic-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .forensic-time { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--text-muted); }
    .tag {
      font-size: 8px; font-weight: 700; text-transform: uppercase;
      padding: 2px 5px; border-radius: 3px; letter-spacing: 0.5px;
    }
    .tag-critical { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
    .tag-high { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
    .tag-medium { background: rgba(59, 130, 246, 0.2); color: var(--info); }
    .tag-low { background: rgba(107, 114, 128, 0.2); color: #6b7280; }

    .forensic-case {
      font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600;
      margin-bottom: 3px; display: flex; align-items: center; gap: 6px;
    }
    .forensic-type { font-size: 10px; color: var(--text-secondary); margin-bottom: 4px; }
    .forensic-assertion {
      font-size: 11px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;
      padding: 6px 8px; background: rgba(239, 68, 68, 0.1); border-radius: 4px;
    }
    .forensic-details { font-size: 10px; color: var(--text-muted); line-height: 1.4; font-family: 'JetBrains Mono', monospace; }
    .code-snippet {
      margin-top: 4px; padding: 6px 10px; background: #1e1e2e; color: #cdd6f4; border-radius: 5px;
      font-family: 'JetBrains Mono', monospace; font-size: 10px; line-height: 1.5;
      overflow-x: auto; white-space: pre; max-height: 160px;
    }
    .code-snippet .line-highlight { color: #f9e2af; font-weight: 600; }
    .code-snippet .line-normal { color: #6c7086; }
    .evidence-refs {
      margin-top: 6px; padding: 6px 8px; background: rgba(0, 0, 0, 0.03); border-radius: 4px;
      font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--text-muted); line-height: 1.6;
    }
    .evidence-refs div { padding: 1px 0; }
    .evidence-refs div::before { content: '↳ '; color: var(--accent); }
    .fix-hint {
      margin-top: 4px; padding: 5px 8px; background: rgba(59, 130, 246, 0.1);
      border-left: 3px solid var(--accent); border-radius: 4px; font-size: 10px; line-height: 1.4;
    }
    .finding-labels { margin-top: 6px; display: flex; gap: 4px; flex-wrap: wrap; }
    .finding-label {
      font-size: 8px; padding: 1px 5px; border-radius: 3px;
      background: rgba(0,0,0,0.05); color: var(--text-secondary); font-weight: 600;
    }

    .provenance-panel { margin-top: 20px; }
    .provenance-panel summary {
      padding: 12px 16px; cursor: pointer; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-secondary);
      background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; user-select: none;
    }
    .provenance-panel summary:hover { color: var(--accent); }
    .provenance-panel[open] summary { border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom-color: transparent; }
    .provenance-grid {
      padding: 16px; background: var(--bg-secondary); border: 1px solid var(--border);
      border-top: none; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;
      display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; font-size: 11px;
    }
    .provenance-item { padding: 8px; background: rgba(0, 0, 0, 0.02); border-radius: 4px; }
    .provenance-item strong { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); margin-bottom: 4px; }
    .provenance-item span { font-family: 'JetBrains Mono', monospace; font-size: 10px; }
    .provenance-item .pass { color: var(--success); font-weight: 600; }
    .provenance-item .fail { color: var(--danger); font-weight: 600; }

    /* Promise vs Reality */
    .promise-claims { display: flex; flex-direction: column; gap: 2px; }
    .promise-claim { display: flex; align-items: center; gap: 6px; padding: 4px 0; font-size: 11px; }
    .promise-status { width: 16px; text-align: center; font-weight: 700; }
    .promise-implemented { color: var(--success); }
    .promise-partial { color: var(--warning); }
    .promise-stub { color: var(--text-muted); }
    .promise-missing { color: var(--danger); }
    .promise-label { font-weight: 600; }
    .promise-conf { font-size: 9px; color: var(--text-muted); margin-left: auto; text-transform: uppercase; }
    .promise-evidence { font-size: 10px; color: var(--text-secondary); padding-left: 22px; margin-bottom: 4px; }
    .promise-verdict { margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.03); border-radius: 4px; font-size: 11px; font-weight: 600; }

    /* Purpose Alignment Plan */
    .purpose-group { margin-bottom: 10px; }
    .purpose-group-header { font-size: 11px; font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
    .purpose-gap { padding: 8px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 6px; }
    .purpose-gap-header { display: flex; align-items: center; gap: 6px; font-size: 11px; }
    .purpose-gap-title { font-weight: 600; flex: 1; }
    .purpose-gap-effort { font-size: 9px; color: var(--text-muted); white-space: nowrap; }
    .purpose-gap-why { font-size: 10px; color: var(--text-secondary); margin-top: 4px; line-height: 1.4; }

    /* Production Roadmap */
    .roadmap-phase { margin-bottom: 6px; }
    .roadmap-phase summary {
      padding: 8px 10px; font-size: 11px; cursor: pointer; background: var(--bg-secondary);
      border: 1px solid var(--border); border-radius: 6px; display: flex; align-items: center; gap: 8px;
    }
    .roadmap-phase[open] summary { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
    .roadmap-phase-num { font-weight: 700; color: var(--accent); min-width: 50px; }
    .roadmap-phase-title { font-weight: 600; flex: 1; }
    .roadmap-phase-meta { font-size: 9px; color: var(--text-muted); }
    .roadmap-phase-desc { font-size: 10px; color: var(--text-secondary); padding: 6px 10px; border: 1px solid var(--border); border-top: none; }
    .roadmap-items { border: 1px solid var(--border); border-top: none; border-bottom-left-radius: 6px; border-bottom-right-radius: 6px; }
    .roadmap-item { padding: 8px 10px; border-bottom: 1px solid var(--border); }
    .roadmap-item:last-child { border-bottom: none; }
    .roadmap-item-header { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; }
    .roadmap-item-num { width: 18px; height: 18px; border-radius: 50%; background: var(--accent); color: white; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; flex-shrink: 0; }
    .roadmap-item-file { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--text-muted); margin-top: 2px; }
    .roadmap-item-explain { font-size: 10px; color: var(--text-secondary); margin-top: 3px; }
    .roadmap-item-steps { margin-top: 4px; }
    .roadmap-step { font-size: 10px; color: var(--text-secondary); padding: 1px 0; }

    /* Agent Rules */
    .rules-preview { max-height: 300px; overflow-y: auto; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 4px; padding: 8px; }
    .rules-preview pre { font-family: 'JetBrains Mono', monospace; font-size: 10px; white-space: pre-wrap; margin: 0; color: var(--text-secondary); }

    /* Triage & Fix Guide Tabs */
    .triage-section { margin-bottom: 14px; }
    .triage-tabs { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: 0; }
    .triage-tab {
      padding: 7px 14px; font-size: 10px; font-weight: 600; cursor: pointer;
      background: transparent; border: none; color: var(--text-muted);
      border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.2s;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .triage-tab:hover { color: var(--text-primary); }
    .triage-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
    .triage-tab .tab-count {
      display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 10px;
      font-size: 9px; font-weight: 700; background: rgba(0,0,0,0.06);
    }
    .triage-tab.active .tab-count { background: rgba(59, 130, 246, 0.15); color: var(--accent); }
    .triage-panel { display: none; padding: 10px 0; }
    .triage-panel.active { display: block; }

    .fix-card {
      background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px;
      padding: 10px 12px; margin-bottom: 8px; transition: border-color 0.2s;
    }
    .fix-card:hover { border-color: var(--accent); }
    .fix-card-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .fix-card-num {
      width: 20px; height: 20px; border-radius: 50%; background: var(--accent); color: white;
      display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700;
      flex-shrink: 0;
    }
    .fix-card-title { font-size: 12px; font-weight: 600; flex: 1; }
    .fix-card-loc { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--text-muted); margin-bottom: 4px; }
    .fix-card-impact { font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; line-height: 1.4; }
    .fix-card-action {
      padding: 6px 10px; background: rgba(59, 130, 246, 0.08); border-left: 3px solid var(--accent);
      border-radius: 0 6px 6px 0; font-size: 10px; line-height: 1.4;
    }
    .fix-card-action strong { color: var(--accent); }
    .fix-card-downstream {
      margin-top: 8px; font-size: 10px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;
      padding: 6px 8px; background: rgba(0,0,0,0.02); border-radius: 4px;
    }
    .fix-card-downstream::before { content: '↓ '; color: var(--warning); }

    .prompt-modal-overlay {
      display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;
    }
    .prompt-modal-overlay.show { display: flex; }
    .prompt-modal {
      background: var(--bg-primary); border-radius: 12px; width: 700px; max-height: 80vh;
      display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .prompt-modal-header {
      padding: 16px 20px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
    }
    .prompt-modal-header h3 { font-size: 14px; font-weight: 600; }
    .prompt-modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
    .prompt-modal-body pre {
      font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.6;
      white-space: pre-wrap; word-break: break-word; color: var(--text-primary);
    }
    .prompt-modal-footer { padding: 12px 20px; border-top: 1px solid var(--border); display: flex; gap: 8px; justify-content: flex-end; }
    .btn {
      padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;
      border: 1px solid var(--border); transition: all 0.2s;
    }
    .btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
    .btn-primary:hover { opacity: 0.9; }
    .btn-ghost { background: transparent; color: var(--text-secondary); }
    .btn-ghost:hover { background: rgba(0,0,0,0.05); }
    .copy-success { color: var(--success); font-size: 11px; font-weight: 600; display: none; align-items: center; gap: 4px; }

    .symptoms-section { margin-bottom: 14px; }
    .symptoms-header {
      font-size: 12px; font-weight: 700; margin-bottom: 8px; color: var(--text-primary);
      display: flex; align-items: center; gap: 8px;
    }
    .symptoms-header span { font-size: 9px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.8px; }
    .symptom-card {
      background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px;
      padding: 8px 12px; margin-bottom: 5px; cursor: pointer; transition: all 0.2s;
    }
    .symptom-card:hover { border-color: var(--accent); }
    .symptom-card.open { border-color: var(--accent); background: rgba(59, 130, 246, 0.03); }
    .symptom-top { display: flex; align-items: center; gap: 10px; }
    .symptom-icon { font-size: 10px; font-weight: 700; color: var(--accent); font-family: 'JetBrains Mono', monospace; flex-shrink: 0; }
    .symptom-headline { font-size: 12px; font-weight: 600; color: var(--text-primary); flex: 1; }
    .symptom-count {
      font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px;
      background: rgba(239, 68, 68, 0.1); color: var(--danger); flex-shrink: 0;
    }
    .symptom-explain {
      font-size: 10px; color: var(--text-secondary); line-height: 1.5; margin-top: 6px;
      padding: 6px 10px; background: rgba(0,0,0,0.02); border-radius: 4px;
    }
    .symptom-detail { display: none; margin-top: 6px; }
    .symptom-card.open .symptom-detail { display: block; }
    .symptom-file-list {
      list-style: none; padding: 0; margin: 8px 0 0 0;
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
    }
    .symptom-file-list li {
      padding: 4px 8px; color: var(--text-muted); display: flex; align-items: center; gap: 6px;
    }
    .symptom-file-list li::before { content: '→'; color: var(--accent); }
    .symptom-arrow { font-size: 11px; color: var(--text-muted); transition: transform 0.2s; }
    .symptom-card.open .symptom-arrow { transform: rotate(90deg); }

    .explain-toggle {
      font-size: 10px; color: var(--accent); cursor: pointer; background: none; border: none;
      font-weight: 600; padding: 4px 0; display: flex; align-items: center; gap: 4px;
    }
    .explain-toggle:hover { text-decoration: underline; }
    .explain-box {
      display: none; margin-top: 6px; padding: 10px; background: rgba(59, 130, 246, 0.04);
      border: 1px solid rgba(59, 130, 246, 0.15); border-radius: 6px;
    }
    .explain-box.open { display: block; }
    .explain-what { font-size: 11px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; line-height: 1.4; }
    .explain-why { font-size: 10px; color: var(--text-secondary); margin-bottom: 8px; line-height: 1.5; padding: 6px 8px; background: rgba(239, 68, 68, 0.05); border-radius: 4px; }
    .explain-why::before { content: 'Why this matters: '; font-weight: 700; color: var(--danger); }
    .explain-steps { list-style: none; counter-reset: step; padding: 0; margin: 0 0 8px 0; }
    .explain-steps li {
      counter-increment: step; font-size: 10px; color: var(--text-secondary); line-height: 1.5;
      padding: 4px 6px 4px 32px; position: relative; margin-bottom: 3px;
      background: rgba(0,0,0,0.02); border-radius: 4px;
    }
    .explain-steps li::before {
      content: counter(step); position: absolute; left: 6px; top: 4px;
      width: 18px; height: 18px; border-radius: 50%; background: var(--accent);
      color: white; font-size: 9px; font-weight: 700; display: flex;
      align-items: center; justify-content: center;
    }
    .explain-prompt-box {
      position: relative; padding: 10px 12px; background: #1e1e2e; color: #cdd6f4;
      border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 10px;
      line-height: 1.5; white-space: pre-wrap; word-break: break-word;
    }
    .explain-prompt-box .copy-btn {
      position: absolute; top: 6px; right: 6px; padding: 4px 10px; font-size: 9px;
      background: rgba(255,255,255,0.1); color: #cdd6f4; border: 1px solid rgba(255,255,255,0.2);
      border-radius: 4px; cursor: pointer; font-weight: 600;
    }
    .explain-prompt-box .copy-btn:hover { background: rgba(255,255,255,0.2); }
    .explain-label {
      font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;
      color: var(--text-muted); margin-bottom: 6px;
    }

    @media print {
      @page { size: A4; margin: 10mm 10mm; }
      body { font-size: 8px; line-height: 1.25; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .container { padding: 0; max-width: 100%; display: flex; flex-direction: column; }

      /* Hide interactive elements */
      .header-actions, .filter-row, .forensic-search, .prompt-modal-overlay,
      .explain-toggle, .explain-box, .triage-section, .provenance-panel,
      .symptom-detail, .symptom-arrow, .finding-labels { display: none !important; }

      /* Reorder: header(1), metrics(2), categories grid(3), status(4), symptoms(5), fixes(6), findings(7) */
      .header { order: 1; }
      .metrics-grid { order: 2; }
      .grid { order: 3; }
      .status-bar { order: 4; }
      .ship-decision { order: 5; }
      .symptoms-section { order: 6; }
      .root-causes { order: 7; }

      /* Header compact */
      .header { padding: 2px 0; margin-bottom: 4px; border-bottom: 2px solid var(--text-primary); }
      .brand-icon { width: 16px; height: 16px; font-size: 9px; border-radius: 3px; }
      .brand-text { font-size: 11px; }
      .brand-subtitle { font-size: 7px; }

      /* Metrics — prominent at top */
      .metrics-grid { gap: 6px; margin-bottom: 6px; grid-template-columns: repeat(4, 1fr); }
      .metric { padding: 6px 4px; border-radius: 4px; }
      .metric-label { font-size: 7px; margin-bottom: 2px; letter-spacing: 1px; }
      .metric-value { font-size: 20px; }
      .metric-subtitle { font-size: 7px; margin-top: 1px; }

      /* Category + findings as two-column — VISUAL at top */
      .grid { grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px; }

      /* Cards compact */
      .card { margin-bottom: 4px; border-radius: 4px; }
      .card-header { padding: 3px 6px; }
      .card-title { font-size: 7px; }
      .card-body { padding: 4px 6px; }

      /* Category lanes — visual bars prominent */
      .timeline-lane { padding: 3px 5px; margin-bottom: 2px; border-radius: 3px; }
      .lane-header { margin-bottom: 2px; gap: 3px; }
      .lane-badge { width: 12px; height: 12px; font-size: 6px; border-radius: 2px; }
      .lane-name { font-size: 8px; }
      .lane-stats { font-size: 7px; }
      .lane-bar { height: 4px; border-radius: 2px; }
      .lane-bar-fill { border-radius: 2px; }

      /* Smell grid compact */
      .smell-grid { gap: 2px; }
      .smell-item { padding: 2px 4px; font-size: 7px; }
      .smell-count { font-size: 8px; }

      /* Gates compact */
      .gate-item { padding: 2px 4px; font-size: 8px; gap: 3px; }
      .gate-icon { font-size: 9px; }
      .gate-reason { font-size: 7px; }

      /* Status bar — after visual section */
      .status-bar { padding: 4px 8px; margin-bottom: 4px; border-radius: 4px; }
      .status-badge { width: 18px; height: 18px; font-size: 10px; }
      .status-info h3 { font-size: 9px; }
      .status-info p { font-size: 7px; }
      .status-meta { font-size: 7px; }
      .status-meta div { margin-bottom: 0; }

      /* Ship decision compact */
      .ship-decision { padding: 4px 8px; margin-bottom: 4px; border-radius: 4px; }
      .decision-header { margin-bottom: 2px; gap: 6px; }
      .decision-badge { padding: 1px 5px; font-size: 7px; }
      .decision-label { font-size: 7px; }
      .decision-reason { font-size: 7px; margin-bottom: 2px; }
      .decision-action { font-size: 7px; padding: 2px 5px; }

      /* Symptoms compact */
      .symptoms-section { margin-bottom: 4px; }
      .symptoms-header { font-size: 8px; margin-bottom: 3px; }
      .symptom-card { padding: 2px 5px; margin-bottom: 1px; border: none; background: none; }
      .symptom-icon { font-size: 6px; }
      .symptom-headline { font-size: 7px; }
      .symptom-count { font-size: 6px; padding: 0 3px; }

      /* Fix These First compact */
      .root-causes { margin-bottom: 4px; border-radius: 4px; }
      .root-causes summary { padding: 3px 6px; font-size: 7px; }
      .root-causes-list { padding: 3px 6px; }
      .root-cause-item { margin-bottom: 2px; padding: 2px 4px; }
      .root-cause-header { font-size: 7px; margin-bottom: 0; }
      .root-cause-tests { font-size: 6px; }
      .tag { font-size: 6px; padding: 1px 3px; }

      /* Forensic panel — compact findings list */
      .forensic-panel { position: static; height: auto; overflow: visible; }
      .forensic-list { overflow: visible; max-height: none; padding: 2px; }
      .forensic-item { padding: 2px 4px; margin-bottom: 1px; page-break-inside: avoid; }
      .forensic-header { margin-bottom: 0; }
      .forensic-time { font-size: 6px; }
      .forensic-case { font-size: 7px; margin-bottom: 0; }
      .forensic-type { font-size: 6px; }
      .forensic-details { font-size: 6px; line-height: 1.2; }
      .code-snippet { display: none; }
      .evidence-refs { display: none; }
      .fix-hint { margin-top: 1px; padding: 1px 3px; font-size: 6px; }
    }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.1); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.2); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">
        <div class="brand-icon">F</div>
        <div>
          <div class="brand-text">FLAW Report</div>
          <div class="brand-subtitle">Flow Logic Audit Watch</div>
        </div>
      </div>
      <div class="header-actions">
        <button onclick="window.print()">Export PDF</button>
        <button onclick="exportReport()">Download HTML</button>
        <button onclick="openPromptModal()">Copy AI Prompt</button>
      </div>
    </div>

    <div class="status-bar">
      <div class="status-left">
        <div class="status-badge ${summary.status === 'pass' ? 'status-verified' : summary.status === 'conditional-pass' ? 'status-warning' : 'status-failed'}">
          ${summary.status === 'pass' ? '&#10003;' : summary.status === 'conditional-pass' ? '!' : '&#10007;'}
        </div>
        <div class="status-info">
          <h3>STATUS: ${summary.status.toUpperCase().replace('-', ' ')}</h3>
          <p>${summary.rating.replace(/-/g, ' ')}</p>
        </div>
      </div>
      <div class="status-meta">
        <div><strong>Date:</strong> ${new Date(report.generatedAt).toLocaleString()}</div>
        <div><strong>Score:</strong> ${summary.totalScore}/100</div>
        <div><strong>Duration:</strong> ${audit.durationMs}ms</div>
        <div><strong>Project:</strong> ${escapeHtml(project.name)}</div>
      </div>
    </div>

    <div class="ship-decision">
      <div class="decision-header">
        <span class="decision-label">Ship Decision</span>
        <span class="decision-badge ${shipClass}">${shipDecision}</span>
      </div>
      <div class="decision-reason">
        <strong>Reason:</strong> ${summary.criticalCount} critical, ${summary.highCount} high, ${summary.mediumCount} medium issues across ${scores.filter(s => s.status === 'fail').length} failing categories
      </div>
      <div class="decision-action">
        <strong>Recommendation:</strong> ${escapeHtml(summary.recommendation)}
      </div>
    </div>

    ${symptoms.length > 0 ? `
    <div class="symptoms-section">
      <div class="symptoms-header">
        This is why you're experiencing these problems
        <span>${symptoms.length} symptoms detected</span>
      </div>
      ${symptoms.map((s, si) => `
      <div class="symptom-card" onclick="this.classList.toggle('open')">
        <div class="symptom-top">
          <div class="symptom-icon">${s.icon}</div>
          <div class="symptom-headline">${escapeHtml(s.headline)}</div>
          <div class="symptom-count">${s.findings.length} cause${s.findings.length > 1 ? 's' : ''}</div>
          <div class="symptom-arrow">&#9654;</div>
        </div>
        <div class="symptom-detail">
          <div class="symptom-explain">${escapeHtml(s.explanation)}</div>
          <ul class="symptom-file-list">
            ${s.findings.slice(0, 8).map(f => `<li>${escapeHtml(f.title)} <span style="opacity:0.5">${escapeHtml(f.location.file)}${f.location.startLine ? ':' + f.location.startLine : ''}</span></li>`).join('')}
            ${s.findings.length > 8 ? `<li style="color: var(--text-muted)">...and ${s.findings.length - 8} more</li>` : ''}
          </ul>
        </div>
      </div>`).join('')}
    </div>` : ''}

    ${(triage?.topThree || topFindings).length > 0 ? `
    <details class="root-causes" open>
      <summary>Fix These First</summary>
      <div class="root-causes-list">
        ${(triage?.topThree || topFindings).map((f, i) => `
        <div class="root-cause-item">
          <div class="root-cause-header">
            <span class="tag ${severityClass(f.severity)}" style="margin-right: 6px">${f.severity.toUpperCase()}</span>
            ${i + 1}. ${escapeHtml(f.title)}
          </div>
          <div class="root-cause-tests">${escapeHtml(f.ruleId)} &middot; ${f.location.file}${f.location.startLine ? `:${f.location.startLine}` : ''}</div>
          ${f.suggestedFix ? `<div style="margin-top: 4px; font-size: 10px; color: var(--text-secondary);">Fix: ${escapeHtml(f.suggestedFix)}</div>` : ''}
        </div>`).join('')}
      </div>
    </details>` : ''}

    ${triage && triage.groups.length > 0 ? `
    <div class="triage-section">
      <div class="triage-tabs">
        ${triage.groups.map((g, i) => `
        <button class="triage-tab${i === 0 ? ' active' : ''}" onclick="switchTriageTab(${i}, this)">
          P${g.priority} — ${escapeHtml(g.label)}
          <span class="tab-count">${g.findings.length}</span>
        </button>`).join('')}
      </div>
      ${triage.groups.map((g, gi) => `
      <div class="triage-panel${gi === 0 ? ' active' : ''}" data-panel="${gi}">
        <div style="margin-bottom: 12px; font-size: 11px; color: var(--text-secondary);">
          <span class="tag tag-${g.blastRadius === 'critical' ? 'critical' : g.blastRadius === 'high' ? 'high' : 'medium'}" style="margin-right: 6px">${g.blastRadius.toUpperCase()} BLAST RADIUS</span>
          ${escapeHtml(g.rationale)}
        </div>
        ${g.findings.map((f, fi) => {
          const ex = getExplanation(f.ruleId);
          const findingPrompt = getFindingPrompt(f);
          const cardId = `card-${gi}-${fi}`;
          return `
        <div class="fix-card">
          <div class="fix-card-header">
            <div class="fix-card-num">${fi + 1}</div>
            <div class="fix-card-title">${escapeHtml(f.title)}</div>
            <span class="tag ${severityClass(f.severity)}">${f.severity.toUpperCase()}</span>
          </div>
          <div class="fix-card-loc">${escapeHtml(f.ruleId)} &middot; ${escapeHtml(f.location.file)}${f.location.startLine ? `:${f.location.startLine}` : ''} &middot; ${f.confidence} confidence</div>
          ${ex ? `<div class="explain-what">${escapeHtml(ex.what)}</div>` : `<div class="fix-card-impact">${escapeHtml(f.summary)}</div>`}
          ${ex ? `<div class="explain-why">${escapeHtml(ex.why)}</div>` : ''}
          ${f.codeSnippet ? `<div class="code-snippet">${f.codeSnippet.split('\n').map(line => {
            const isHighlighted = line.startsWith('>');
            return `<span class="${isHighlighted ? 'line-highlight' : 'line-normal'}">${escapeHtml(line)}</span>`;
          }).join('\n')}</div>` : ''}
          ${ex ? `
          <button class="explain-toggle" onclick="toggleExplain('${cardId}')">&#9432; How do I fix this? (step by step)</button>
          <div class="explain-box" id="${cardId}">
            <div class="explain-label">Step-by-step fix</div>
            <ol class="explain-steps">
              ${ex.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
            </ol>
            <div class="explain-label">Paste this into your AI coding assistant</div>
            <div class="explain-prompt-box">
              <button class="copy-btn" onclick="copyText(this, \`${escapeHtml(findingPrompt).replace(/`/g, '\\`').replace(/\\/g, '\\\\')}\`)">Copy</button>${escapeHtml(findingPrompt)}</div>
          </div>` : (f.suggestedFix ? `<div class="fix-card-action"><strong>Fix:</strong> ${escapeHtml(f.suggestedFix)}</div>` : '')}
          ${f.evidenceRefs && f.evidenceRefs.length > 0 ? f.evidenceRefs.filter(r => r.startsWith('Affects')).map(r => `<div class="fix-card-downstream">${escapeHtml(r)}</div>`).join('') : ''}
        </div>`;
        }).join('')}
      </div>`).join('')}
    </div>` : ''}

    <div class="metrics-grid">
      <div class="metric" onclick="applyFilter('all', this)">
        <div class="metric-label">Score</div>
        <div class="metric-value" style="color: ${summary.totalScore >= 75 ? 'var(--success)' : summary.totalScore >= 60 ? 'var(--warning)' : 'var(--danger)'}">${summary.totalScore}</div>
        <div class="metric-subtitle">of 100</div>
      </div>
      <div class="metric" onclick="applyFilter('critical', this)">
        <div class="metric-label">Critical</div>
        <div class="metric-value" style="color: ${summary.criticalCount > 0 ? 'var(--danger)' : 'var(--success)'}">${summary.criticalCount}</div>
        <div class="metric-subtitle">launch blockers</div>
      </div>
      <div class="metric" onclick="applyFilter('high', this)">
        <div class="metric-label">High</div>
        <div class="metric-value" style="color: ${summary.highCount > 0 ? 'var(--warning)' : 'var(--success)'}">${summary.highCount}</div>
        <div class="metric-subtitle">serious risks</div>
      </div>
      <div class="metric">
        <div class="metric-label">AI Smell Index</div>
        <div class="metric-value" style="color: ${smellIndex.score >= 6 ? 'var(--danger)' : smellIndex.score >= 3 ? 'var(--warning)' : 'var(--success)'}">${smellIndex.score}</div>
        <div class="metric-subtitle">${smellIndex.level}</div>
      </div>
    </div>

    <div class="grid">
      <div>
        <!-- Category Scores -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Category Scores</div>
            <div style="font-size: 10px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;">
              ${scores.length} categories &middot; ${totalFindings} findings
            </div>
          </div>
          <div class="card-body">
            ${scores.map(cat => {
              const pct = (cat.score / cat.maxScore) * 100;
              const color = pct >= 75 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';
              const catFindings = findingsByCategory.get(cat.categoryId) || [];
              return `
            <div class="timeline-lane" onclick="filterCategory('${cat.categoryId}')">
              <div class="lane-header">
                <div class="lane-badge" style="background: ${categoryBadgeColor(cat.categoryId)}">${cat.categoryId.charAt(0)}</div>
                <div class="lane-name">${escapeHtml(cat.categoryName)}</div>
                <div class="lane-stats">${cat.score}/${cat.maxScore}${catFindings.length > 0 ? ` &middot; ${catFindings.length} issues` : ''}</div>
              </div>
              <div class="lane-bar">
                <div class="lane-bar-fill" style="width: ${pct}%; background: ${color};"></div>
              </div>
            </div>`;
            }).join('')}
          </div>
        </div>

        <!-- AI Smell Index -->
        ${smellIndex.smells.length > 0 ? `
        <div class="card">
          <div class="card-header">
            <div class="card-title">AI Smell Index</div>
            <div style="font-size: 10px; color: var(--text-muted);">${smellIndex.score}/${smellIndex.maxScore} (${smellIndex.level})</div>
          </div>
          <div class="card-body">
            <div class="smell-grid">
              ${smellIndex.smells.map(s => `
              <div class="smell-item">
                <span>${escapeHtml(s.label)}</span>
                <span class="smell-count">${s.count}</span>
              </div>`).join('')}
            </div>
          </div>
        </div>` : ''}

        <!-- Gates -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Launch Gates</div>
            <div style="font-size: 10px; color: var(--text-muted);">${passedGates.length}/${gates.length} passed</div>
          </div>
          <div class="card-body">
            ${gates.map(g => `
            <div class="gate-item ${g.status === 'pass' ? 'gate-pass' : 'gate-fail'}">
              <span class="gate-icon">${g.status === 'pass' ? '&#10003;' : '&#10007;'}</span>
              <span>${escapeHtml(g.label)}</span>
              ${g.reason ? `<span class="gate-reason">${escapeHtml(g.reason)}</span>` : ''}
            </div>`).join('')}
          </div>
        </div>

        <!-- Provenance -->
        <details class="provenance-panel" open>
          <summary>Run Context &amp; Provenance</summary>
          <div class="provenance-grid">
            ${project.branch ? `<div class="provenance-item"><strong>Branch</strong><span>${escapeHtml(project.branch)}</span></div>` : ''}
            ${project.commitSha ? `<div class="provenance-item"><strong>Commit</strong><span>${escapeHtml(project.commitSha)}</span></div>` : ''}
            ${project.framework ? `<div class="provenance-item"><strong>Framework</strong><span>${escapeHtml(project.framework)}</span></div>` : ''}
            ${project.packageManager ? `<div class="provenance-item"><strong>Package Manager</strong><span>${escapeHtml(project.packageManager)}</span></div>` : ''}
            <div class="provenance-item"><strong>Audit Mode</strong><span>${audit.mode}</span></div>
            <div class="provenance-item"><strong>Timestamp</strong><span>${report.generatedAt}</span></div>
            <div class="provenance-item"><strong>Engine</strong><span>FLAW v2.0.0</span></div>
            <div class="provenance-item"><strong>Status</strong><span class="${summary.status === 'pass' ? 'pass' : 'fail'}">${summary.status.toUpperCase()}</span></div>
          </div>
        </details>
      </div>

      <!-- Promise vs Reality -->
      ${promiseReality && promiseReality.claims.length > 0 ? `
      <div class="card promise-reality-panel">
        <div class="card-header">
          <div class="card-title">Promise vs Reality</div>
          <div style="font-size: 10px; color: var(--text-muted);">Reality Score: <strong style="color: ${promiseReality.realityScore >= 70 ? 'var(--success)' : promiseReality.realityScore >= 40 ? 'var(--warning)' : 'var(--danger)'}">${promiseReality.realityScore}%</strong></div>
        </div>
        <div class="card-body">
          <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">${escapeHtml(promiseReality.projectPurpose)}</div>
          <div class="promise-claims">
            ${promiseReality.claims.map(c => `
            <div class="promise-claim">
              <span class="promise-status promise-${c.status}">${c.status === 'implemented' ? '&#10003;' : c.status === 'partial' ? '&#9679;' : c.status === 'stub' ? '&#9675;' : '&#10007;'}</span>
              <span class="promise-label">${escapeHtml(c.claim)}</span>
              <span class="promise-conf">${c.confidence}</span>
            </div>
            <div class="promise-evidence">${escapeHtml(c.evidence)}</div>`).join('')}
          </div>
          <div class="promise-verdict">${escapeHtml(promiseReality.verdict)}</div>
        </div>
      </div>` : ''}

      <!-- Purpose Alignment Plan -->
      ${purposePlan && purposePlan.gaps.length > 0 ? `
      <div class="card purpose-plan-panel">
        <div class="card-header">
          <div class="card-title">Get Back on Track</div>
          <div style="font-size: 10px; color: var(--text-muted);">${purposePlan.gaps.length} gap${purposePlan.gaps.length > 1 ? 's' : ''} to close</div>
        </div>
        <div class="card-body">
          <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">${escapeHtml(purposePlan.summary)}</div>
          ${(['must-have', 'should-have', 'nice-to-have'] as const).map(priority => {
            const group = purposePlan!.gaps.filter(g => g.priority === priority);
            if (group.length === 0) return '';
            const label = priority === 'must-have' ? 'Must-Have — Start Here'
              : priority === 'should-have' ? 'Should-Have — Do Next'
              : 'Nice-to-Have — When You Have Time';
            const tagClass = priority === 'must-have' ? 'tag-critical' : priority === 'should-have' ? 'tag-high' : 'tag-medium';
            return `
          <div class="purpose-group">
            <div class="purpose-group-header"><span class="tag ${tagClass}">${priority.toUpperCase()}</span> ${label}</div>
            ${group.map(gap => {
              const statusTag = gap.status === 'missing' ? 'MISSING' : gap.status === 'stub' ? 'STUB' : 'PARTIAL';
              const statusClass = gap.status === 'missing' ? 'promise-missing' : gap.status === 'stub' ? 'promise-stub' : 'promise-partial';
              const gapId = `gap-${gap.feature.replace(/[^a-zA-Z0-9]/g, '')}`;
              return `
            <div class="purpose-gap">
              <div class="purpose-gap-header">
                <span class="tag ${statusClass === 'promise-missing' ? 'tag-critical' : statusClass === 'promise-stub' ? 'tag-medium' : 'tag-low'}" style="font-size: 8px">${statusTag}</span>
                <span class="purpose-gap-title">${escapeHtml(gap.feature)}</span>
                <span class="purpose-gap-effort">${gap.estimatedEffort}</span>
              </div>
              <div class="purpose-gap-why">${escapeHtml(gap.whyItMatters)}</div>
              <button class="explain-toggle" onclick="toggleExplain('${gapId}')">&#9432; How to implement</button>
              <div class="explain-box" id="${gapId}">
                <div class="explain-label">Implementation steps</div>
                <ol class="explain-steps">
                  ${gap.implementationGuide.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
                </ol>
                ${gap.techHints.length > 0 ? `
                <div class="explain-label">Framework tips (${escapeHtml(project.framework || 'general')})</div>
                <ul class="explain-steps">${gap.techHints.map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul>` : ''}
                <div class="explain-label">Paste this into your AI coding assistant</div>
                <div class="explain-prompt-box">
                  <button class="copy-btn" onclick="copyText(this, \`${escapeHtml(gap.prompt).replace(/`/g, '\\`').replace(/\\/g, '\\\\')}\`)">Copy</button>${escapeHtml(gap.prompt)}</div>
              </div>
            </div>`;
            }).join('')}
          </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <!-- Production Roadmap -->
      ${roadmap.phases.length > 0 ? `
      <div class="card roadmap-panel">
        <div class="card-header">
          <div class="card-title">Production Roadmap</div>
          <div style="font-size: 10px; color: var(--text-muted);">${roadmap.estimatedPhases} phases</div>
        </div>
        <div class="card-body">
          <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">${escapeHtml(roadmap.summary)}</div>
          ${roadmap.phases.map(p => `
          <details class="roadmap-phase" ${p.phase === 1 ? 'open' : ''}>
            <summary>
              <span class="roadmap-phase-num">Phase ${p.phase}</span>
              <span class="roadmap-phase-title">${escapeHtml(p.title)}</span>
              <span class="roadmap-phase-meta">${p.items.length} items &middot; ${p.effort}</span>
            </summary>
            <div class="roadmap-phase-desc">${escapeHtml(p.description)}</div>
            <div class="roadmap-items">
              ${p.items.map((item, i) => `
              <div class="roadmap-item">
                <div class="roadmap-item-header">
                  <span class="roadmap-item-num">${i + 1}</span>
                  <span class="tag ${severityClass(item.severity)}">${item.severity.toUpperCase()}</span>
                  <span>${escapeHtml(item.title)}</span>
                </div>
                <div class="roadmap-item-file">${escapeHtml(item.file)}</div>
                <div class="roadmap-item-explain">${escapeHtml(item.explanation)}</div>
                ${item.steps.length > 0 ? `<div class="roadmap-item-steps">${item.steps.map(s => `<div class="roadmap-step">- ${escapeHtml(s)}</div>`).join('')}</div>` : ''}
                <button class="explain-toggle" style="margin-top: 4px;" onclick="event.stopPropagation(); copyText(this, \`${escapeHtml(item.prompt).replace(/`/g, '\\`').replace(/\\/g, '\\\\')}\`)">&#128203; Copy AI prompt</button>
              </div>`).join('')}
            </div>
          </details>`).join('')}
        </div>
      </div>` : ''}

      <!-- Agent Rules Preview -->
      <div class="card rules-panel">
        <div class="card-header">
          <div class="card-title">Agent Rules</div>
          <div style="font-size: 10px; color: var(--text-muted);">.cursorrules / agent rules</div>
        </div>
        <div class="card-body">
          <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">Auto-generated coding rules based on findings. Copy into your project to help AI assistants avoid the same mistakes.</div>
          <div class="rules-preview"><pre>${escapeHtml(agentRules)}</pre></div>
          <button class="explain-toggle" style="margin-top: 6px;" onclick="copyText(this, \`${escapeHtml(agentRules).replace(/`/g, '\\`').replace(/\\/g, '\\\\')}\`)">&#128203; Copy rules</button>
        </div>
      </div>

      <!-- Forensic Panel -->
      <div class="card forensic-panel">
        <div class="card-header">
          <div class="card-title">Findings</div>
          <div style="font-size: 10px; color: var(--text-muted);">${totalFindings} issues</div>
        </div>
        <div class="forensic-search">
          <input type="text" class="search-input" placeholder="Search findings..." id="forensic-search">
          <div class="filter-row">
            <button class="filter-chip active" onclick="applyFilter('all', this)">All (${totalFindings})</button>
            <button class="filter-chip" onclick="applyFilter('critical', this)">Critical (${summary.criticalCount})</button>
            <button class="filter-chip" onclick="applyFilter('high', this)">High (${summary.highCount})</button>
            <button class="filter-chip" onclick="applyFilter('medium', this)">Medium (${summary.mediumCount})</button>
            <button class="filter-chip" onclick="applyFilter('low', this)">Low (${summary.lowCount})</button>
          </div>
        </div>
        <div class="forensic-list" id="forensic-list">
          ${openFindings.map((f, i) => {
            const fex = getExplanation(f.ruleId);
            const fp = getFindingPrompt(f);
            return `
          <div class="forensic-item sev-${f.severity}"
               data-idx="${i}" data-severity="${f.severity}" data-category="${f.categoryId}"
               onclick="selectForensicItem(${i})">
            <div class="forensic-header">
              <div class="forensic-time">${escapeHtml(f.ruleId)}</div>
              <span class="tag ${severityClass(f.severity)}">${f.severity}</span>
            </div>
            <div class="forensic-case">${escapeHtml(f.title)}</div>
            <div class="forensic-type">${escapeHtml(f.location.file)}${f.location.startLine ? `:${f.location.startLine}` : ''} &middot; ${f.confidence} confidence</div>
            ${fex ? `<div class="forensic-details" style="font-family: Inter, sans-serif; font-size: 11px; color: var(--text-primary);">${escapeHtml(fex.what)}</div>` : `<div class="forensic-details">${escapeHtml(f.summary)}</div>`}
            ${f.codeSnippet ? `<div class="code-snippet">${f.codeSnippet.split('\n').map(line => {
              const isHighlighted = line.startsWith('>');
              return `<span class="${isHighlighted ? 'line-highlight' : 'line-normal'}">${escapeHtml(line)}</span>`;
            }).join('\n')}</div>` : ''}
            ${f.evidenceRefs && f.evidenceRefs.length > 0 ? `<div class="evidence-refs">${f.evidenceRefs.map(ref => `<div>${escapeHtml(ref)}</div>`).join('')}</div>` : ''}
            ${fex ? `<div class="fix-hint"><strong>Fix:</strong> ${escapeHtml(fex.steps[0])}</div>` : (f.suggestedFix ? `<div class="fix-hint"><strong>Fix:</strong> ${escapeHtml(f.suggestedFix)}</div>` : '')}
            <button class="explain-toggle" style="margin-top: 4px;" onclick="event.stopPropagation(); copyText(this, \`${escapeHtml(fp).replace(/`/g, '\\`').replace(/\\/g, '\\\\')}\`)">&#128203; Copy AI fix prompt</button>
            ${f.labels.length > 0 ? `<div class="finding-labels">${f.labels.map(l => `<span class="finding-label">${escapeHtml(l)}</span>`).join('')}</div>` : ''}
          </div>`;
          }).join('')}
        </div>
      </div>
    </div>
  </div>

  <div class="prompt-modal-overlay" id="promptModal">
    <div class="prompt-modal">
      <div class="prompt-modal-header">
        <h3>AI-Ready Prompt</h3>
        <button class="btn btn-ghost" onclick="closePromptModal()">&times; Close</button>
      </div>
      <div class="prompt-modal-body">
        <pre id="promptContent">${escapeHtml(triage ? generatePrompt(report, triage) : '')}</pre>
      </div>
      <div class="prompt-modal-footer">
        <span class="copy-success" id="copySuccess">&#10003; Copied!</span>
        <button class="btn btn-ghost" onclick="closePromptModal()">Cancel</button>
        <button class="btn btn-primary" onclick="copyPrompt()">Copy to Clipboard</button>
      </div>
    </div>
  </div>

  <script>
    const reportData = ${JSON.stringify(report)};
    let selectedIdx = null;

    function selectForensicItem(idx) {
      document.querySelectorAll('.forensic-item').forEach(el => el.classList.remove('selected'));
      const item = document.querySelector('.forensic-item[data-idx="' + idx + '"]');
      if (item) { item.classList.add('selected'); item.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      selectedIdx = idx;
    }

    function applyFilter(filter, button) {
      document.querySelectorAll('.filter-chip').forEach(btn => btn.classList.remove('active'));
      if (button) button.classList.add('active');
      document.querySelectorAll('.forensic-item').forEach(item => {
        const severity = item.dataset.severity;
        item.style.display = (filter === 'all' || severity === filter) ? 'block' : 'none';
      });
    }

    function filterCategory(catId) {
      document.querySelectorAll('.filter-chip').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.forensic-item').forEach(item => {
        item.style.display = item.dataset.category === catId ? 'block' : 'none';
      });
    }

    document.getElementById('forensic-search').addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      document.querySelectorAll('.forensic-item').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(query) ? 'block' : 'none';
      });
    });

    function exportReport() {
      const blob = new Blob([document.documentElement.outerHTML], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'flaw-report-' + new Date().toISOString().split('T')[0] + '.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function toggleExplain(id) {
      const box = document.getElementById(id);
      if (box) box.classList.toggle('open');
    }

    function copyText(btn, text) {
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = '\u2713 Copied!';
        btn.style.color = 'var(--success)';
        setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 2000);
      });
    }

    function switchTriageTab(idx, btn) {
      document.querySelectorAll('.triage-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.triage-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.querySelector('.triage-panel[data-panel="' + idx + '"]');
      if (panel) panel.classList.add('active');
    }

    function openPromptModal() {
      document.getElementById('promptModal').classList.add('show');
    }

    function closePromptModal() {
      document.getElementById('promptModal').classList.remove('show');
    }

    function copyPrompt() {
      const text = document.getElementById('promptContent').textContent;
      navigator.clipboard.writeText(text).then(() => {
        const el = document.getElementById('copySuccess');
        el.style.display = 'flex';
        setTimeout(() => { el.style.display = 'none'; }, 2000);
      });
    }

    document.getElementById('promptModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closePromptModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePromptModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const items = Array.from(document.querySelectorAll('.forensic-item')).filter(el => el.style.display !== 'none');
      if (items.length === 0) return;
      let currentIdx = selectedIdx ?? -1;
      let visibleIdx = items.findIndex(item => parseInt(item.dataset.idx) === currentIdx);
      if (visibleIdx === -1) visibleIdx = -1;
      if (e.key === 'j') { visibleIdx = Math.min(visibleIdx + 1, items.length - 1); selectForensicItem(parseInt(items[visibleIdx].dataset.idx)); }
      else if (e.key === 'k') { visibleIdx = Math.max(visibleIdx - 1, 0); selectForensicItem(parseInt(items[visibleIdx].dataset.idx)); }
    });
  </script>
  <footer style="text-align:center;padding:24px 0 16px;font-size:11px;color:#6b7280;border-top:1px solid var(--border);margin-top:32px;">
    © 2026 resetroot99 &amp; ajakvani —
    <a href="https://github.com/resetroot99/FLAW" style="color:#818cf8;text-decoration:none;">FLAW</a>
    — Licensed under BSL 1.1. Commercial use requires a license.
  </footer>
</body>
</html>`;

  const path = join(outputDir, `flaw-report-${Date.now()}.html`);
  writeFileSync(path, html);
  return path;
}
