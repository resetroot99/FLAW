import * as vscode from 'vscode';
import { analyzeFile, FlawFinding } from './analyzer';

export class FlawDiagnosticsProvider implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private findingsMap: Map<string, FlawFinding[]> = new Map();
  private statusBarItem: vscode.StatusBarItem;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  private _onDidUpdateDiagnostics = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidUpdateDiagnostics = this._onDidUpdateDiagnostics.event;

  constructor(statusBarItem: vscode.StatusBarItem) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('flaw');
    this.statusBarItem = statusBarItem;
  }

  analyzeDocument(doc: vscode.TextDocument): void {
    const config = vscode.workspace.getConfiguration('flaw');
    const excludes = config.get<string[]>('excludePatterns', []);

    // Check excludes
    for (const pattern of excludes) {
      if (vscode.languages.match({ pattern }, doc) > 0) return;
    }

    const filePath = vscode.workspace.asRelativePath(doc.uri);
    const content = doc.getText();
    const findings = analyzeFile(filePath, content);

    this.findingsMap.set(doc.uri.toString(), findings);

    const severityMap = config.get<Record<string, string>>('severityMap', {
      critical: 'Error',
      high: 'Error',
      medium: 'Warning',
      low: 'Information',
      info: 'Hint',
    });

    const diagnostics = findings.map(f => {
      const range = new vscode.Range(f.line, 0, f.endLine ?? f.line, lines(content, f.line));
      const severity = mapSeverity(severityMap[f.severity] || 'Warning');
      const diag = new vscode.Diagnostic(range, `[${f.label}] ${f.title}`, severity);
      diag.code = f.ruleId;
      diag.source = 'FLAW';
      diag.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(doc.uri, range),
          f.suggestedFix
        ),
      ];
      return diag;
    });

    this.diagnosticCollection.set(doc.uri, diagnostics);
    this.updateStatusBar();
    this._onDidUpdateDiagnostics.fire(doc.uri);
  }

  debouncedAnalyze(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(key, setTimeout(() => {
      this.analyzeDocument(doc);
      this.debounceTimers.delete(key);
    }, 500));
  }

  async analyzeWorkspace(): Promise<void> {
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx,py}',
      '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**}'
    );

    for (const uri of files) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        this.analyzeDocument(doc);
      } catch {
        // Skip files that can't be opened
      }
    }
  }

  getAllFindings(): FlawFinding[] {
    const all: FlawFinding[] = [];
    for (const findings of this.findingsMap.values()) {
      all.push(...findings);
    }
    return all;
  }

  getFindingsForUri(uri: string): FlawFinding[] {
    return this.findingsMap.get(uri) || [];
  }

  private updateStatusBar(): void {
    const all = this.getAllFindings();
    const critical = all.filter(f => f.severity === 'critical').length;
    const high = all.filter(f => f.severity === 'high').length;
    const total = all.length;

    if (total === 0) {
      this.statusBarItem.text = '$(shield) FLAW: Clean';
      this.statusBarItem.backgroundColor = undefined;
    } else if (critical > 0) {
      this.statusBarItem.text = `$(error) FLAW: ${critical}C ${high}H`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (high > 0) {
      this.statusBarItem.text = `$(warning) FLAW: ${high}H ${total - high}M`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.statusBarItem.text = `$(info) FLAW: ${total} issues`;
      this.statusBarItem.backgroundColor = undefined;
    }
  }

  getDiagnosticCollection(): vscode.DiagnosticCollection {
    return this.diagnosticCollection;
  }

  dispose(): void {
    this.diagnosticCollection.dispose();
    this._onDidUpdateDiagnostics.dispose();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
  }
}

function lines(content: string, lineNum: number): number {
  const line = content.split('\n')[lineNum];
  return line ? line.length : 0;
}

function mapSeverity(level: string): vscode.DiagnosticSeverity {
  switch (level) {
    case 'Error': return vscode.DiagnosticSeverity.Error;
    case 'Warning': return vscode.DiagnosticSeverity.Warning;
    case 'Information': return vscode.DiagnosticSeverity.Information;
    case 'Hint': return vscode.DiagnosticSeverity.Hint;
    default: return vscode.DiagnosticSeverity.Warning;
  }
}
