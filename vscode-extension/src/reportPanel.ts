import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { FlawFinding } from './analyzer';

export class FlawReportPanel {
  static currentPanel: vscode.WebviewPanel | undefined;

  static show(extensionUri: vscode.Uri, findings: FlawFinding[]) {
    const column = vscode.ViewColumn.Beside;

    if (FlawReportPanel.currentPanel) {
      FlawReportPanel.currentPanel.reveal(column);
    } else {
      FlawReportPanel.currentPanel = vscode.window.createWebviewPanel(
        'flawReport',
        'FLAW Report',
        column,
        { enableScripts: true, retainContextWhenHidden: true }
      );

      FlawReportPanel.currentPanel.onDidDispose(() => {
        FlawReportPanel.currentPanel = undefined;
      });
    }

    // Try to run flaw-kit and generate a real HTML report
    FlawReportPanel.generateReport(FlawReportPanel.currentPanel, findings);
  }

  private static async generateReport(panel: vscode.WebviewPanel, findings: FlawFinding[]) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      panel.webview.html = FlawReportPanel.fallbackHtml(findings);
      return;
    }

    // Show loading state
    panel.webview.html = `<!DOCTYPE html><html><body style="background:#0d1117;color:#c9d1d9;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h2>FLAW</h2><p>Generating report...</p></div></body></html>`;

    // Try running flaw-kit to generate HTML report
    const outDir = path.join(workspaceRoot, '.flaw');
    const reportPath = path.join(outDir, 'flaw-report.html');

    try {
      // Ensure output directory exists
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      // Run flaw-kit with --html --out
      await new Promise<void>((resolve, reject) => {
        const proc = cp.exec(
          `npx flaw-kit . --html --quiet --out "${outDir}"`,
          { cwd: workspaceRoot, timeout: 60000 },
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
        proc.stderr?.on('data', () => {}); // swallow stderr
      });

      // Read the generated HTML report
      if (fs.existsSync(reportPath)) {
        let html = fs.readFileSync(reportPath, 'utf-8');

        // Make it work inside a webview (fix CSP issues)
        html = html.replace(/<head>/i, `<head><base href="${panel.webview.asWebviewUri(vscode.Uri.file(outDir))}/">`);

        panel.webview.html = html;
        return;
      }
    } catch {
      // Fall through to fallback
    }

    // Fallback: use inline findings
    panel.webview.html = FlawReportPanel.fallbackHtml(findings);
  }

  private static fallbackHtml(findings: FlawFinding[]): string {
    const critical = findings.filter(f => f.severity === 'critical');
    const high = findings.filter(f => f.severity === 'high');
    const medium = findings.filter(f => f.severity === 'medium');
    const low = findings.filter(f => f.severity === 'low');

    const severityColor: Record<string, string> = {
      critical: '#f85149',
      high: '#f85149',
      medium: '#d29922',
      low: '#8b949e',
      info: '#58a6ff',
    };

    const findingsHtml = findings.map(f => `
      <div style="border:1px solid #30363d;border-left:3px solid ${severityColor[f.severity]};border-radius:6px;padding:12px 16px;margin:8px 0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong style="color:#c9d1d9">${f.title}</strong>
          <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:${severityColor[f.severity]}20;color:${severityColor[f.severity]};font-weight:600;text-transform:uppercase">${f.severity}</span>
        </div>
        <div style="color:#8b949e;font-size:13px;margin-top:4px">
          <code style="color:${severityColor[f.severity]}">[${f.label}]</code> ${f.ruleId} — Line ${f.line + 1}
        </div>
        <div style="color:#8b949e;font-size:13px;margin-top:6px">${f.summary}</div>
        <div style="color:#7ee787;font-size:12px;margin-top:6px;font-style:italic">Fix: ${f.suggestedFix}</div>
      </div>
    `).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; margin: 0; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .subtitle { color: #8b949e; margin-bottom: 24px; }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; }
    .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; text-align: center; flex: 1; }
    .stat-value { font-size: 28px; font-weight: bold; }
    .stat-label { color: #8b949e; font-size: 12px; margin-top: 4px; }
    .section-title { font-size: 16px; font-weight: 600; margin: 24px 0 8px; border-bottom: 1px solid #30363d; padding-bottom: 8px; }
    code { font-family: 'SF Mono', Monaco, monospace; font-size: 12px; }
    .tip { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 16px; margin-top: 24px; color: #8b949e; font-size: 13px; }
  </style>
</head>
<body>
  <h1>FLAW Report</h1>
  <div class="subtitle">Flow Logic Audit Watch — ${findings.length} findings</div>

  <div class="stats">
    <div class="stat">
      <div class="stat-value" style="color:#f85149">${critical.length}</div>
      <div class="stat-label">Critical</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color:#f85149">${high.length}</div>
      <div class="stat-label">High</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color:#d29922">${medium.length}</div>
      <div class="stat-label">Medium</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color:#8b949e">${low.length}</div>
      <div class="stat-label">Low</div>
    </div>
  </div>

  ${critical.length > 0 ? `<div class="section-title" style="color:#f85149">Critical</div>${critical.map(f => findingCard(f)).join('')}` : ''}
  ${high.length > 0 ? `<div class="section-title" style="color:#f85149">High</div>${high.map(f => findingCard(f)).join('')}` : ''}
  ${medium.length > 0 ? `<div class="section-title" style="color:#d29922">Medium</div>${medium.map(f => findingCard(f)).join('')}` : ''}
  ${low.length > 0 ? `<div class="section-title" style="color:#8b949e">Low</div>${low.map(f => findingCard(f)).join('')}` : ''}

  ${findings.length === 0 ? '<div style="text-align:center;padding:48px;color:#7ee787"><h2>All clear</h2><p>No issues found in analyzed files.</p></div>' : ''}

  <div class="tip">
    For a full project-wide report with scoring, roadmap, and purpose alignment, run: <code>npx flaw-kit . --html</code>
  </div>
</body>
</html>`;

    function findingCard(f: FlawFinding): string {
      return `
        <div style="border:1px solid #30363d;border-left:3px solid ${severityColor[f.severity]};border-radius:6px;padding:12px 16px;margin:8px 0">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>${f.title}</strong>
            <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:${severityColor[f.severity]}20;color:${severityColor[f.severity]};font-weight:600">${f.severity}</span>
          </div>
          <div style="color:#8b949e;font-size:13px;margin-top:4px"><code style="color:${severityColor[f.severity]}">[${f.label}]</code> ${f.ruleId} — Line ${f.line + 1}</div>
          <div style="color:#8b949e;font-size:13px;margin-top:6px">${f.summary}</div>
          <div style="color:#7ee787;font-size:12px;margin-top:6px;font-style:italic">Fix: ${f.suggestedFix}</div>
        </div>`;
    }
  }
}
