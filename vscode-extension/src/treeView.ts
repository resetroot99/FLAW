import * as vscode from 'vscode';
import * as path from 'path';

type TreeItem = SummaryItem | FileItem | FindingItem;

class SummaryItem extends vscode.TreeItem {
  contextValue = 'summary';

  constructor(totalFindings: number, fileCount: number) {
    const label = totalFindings === 0
      ? 'No issues found'
      : `${totalFindings} issue${totalFindings === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}`;

    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(
      totalFindings === 0 ? 'pass' : 'warning',
      totalFindings === 0
        ? new vscode.ThemeColor('testing.iconPassed')
        : new vscode.ThemeColor('list.warningForeground')
    );
    this.description = totalFindings === 0 ? 'All clear' : '';
  }
}

class FileItem extends vscode.TreeItem {
  contextValue = 'file';

  constructor(
    public readonly uri: vscode.Uri,
    public readonly diagnostics: vscode.Diagnostic[],
    public readonly workspaceRoot: string | undefined
  ) {
    const relativePath = workspaceRoot
      ? path.relative(workspaceRoot, uri.fsPath)
      : path.basename(uri.fsPath);

    super(relativePath, vscode.TreeItemCollapsibleState.Expanded);

    this.resourceUri = uri;
    this.description = `${diagnostics.length}`;

    const hasError = diagnostics.some(d => d.severity === vscode.DiagnosticSeverity.Error);
    const hasWarning = diagnostics.some(d => d.severity === vscode.DiagnosticSeverity.Warning);

    this.iconPath = new vscode.ThemeIcon(
      'file',
      hasError
        ? new vscode.ThemeColor('list.errorForeground')
        : hasWarning
          ? new vscode.ThemeColor('list.warningForeground')
          : new vscode.ThemeColor('list.deemphasizedForeground')
    );
  }
}

class FindingItem extends vscode.TreeItem {
  contextValue = 'finding';

  constructor(
    public readonly uri: vscode.Uri,
    public readonly diagnostic: vscode.Diagnostic
  ) {
    const title = diagnostic.message.replace(/^\[[^\]]+\]\s*/, '');
    super(title, vscode.TreeItemCollapsibleState.None);

    const line = diagnostic.range.start.line + 1;
    const ruleId = typeof diagnostic.code === 'string'
      ? diagnostic.code
      : (diagnostic.code as { value: string | number })?.value?.toString() || '';

    this.description = `${ruleId} :${line}`;
    this.tooltip = new vscode.MarkdownString(
      `**${title}**\n\n${ruleId} \u2014 Line ${line}\n\n${diagnostic.relatedInformation?.[0]?.message || ''}`
    );

    // Icon based on severity
    let iconId: string;
    let colorId: string;
    switch (diagnostic.severity) {
      case vscode.DiagnosticSeverity.Error:
        iconId = 'error';
        colorId = 'list.errorForeground';
        break;
      case vscode.DiagnosticSeverity.Warning:
        iconId = 'warning';
        colorId = 'list.warningForeground';
        break;
      case vscode.DiagnosticSeverity.Information:
        iconId = 'info';
        colorId = 'list.highlightForeground';
        break;
      default:
        iconId = 'lightbulb';
        colorId = 'list.deemphasizedForeground';
        break;
    }
    this.iconPath = new vscode.ThemeIcon(iconId, new vscode.ThemeColor(colorId));

    // Click navigates to the finding
    this.command = {
      command: 'vscode.open',
      title: 'Go to Finding',
      arguments: [
        uri,
        {
          selection: new vscode.Range(
            diagnostic.range.start.line, 0,
            diagnostic.range.start.line, 0
          ),
        } as vscode.TextDocumentShowOptions,
      ],
    };
  }
}

export class FlawTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      return this.getRootItems();
    }

    if (element instanceof FileItem) {
      return element.diagnostics.map(d => new FindingItem(element.uri, d));
    }

    return [];
  }

  private getRootItems(): TreeItem[] {
    const items: TreeItem[] = [];

    // Collect all FLAW diagnostics grouped by URI
    const fileMap = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();

    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      const flawDiags = diagnostics.filter(d => d.source === 'FLAW');
      if (flawDiags.length > 0) {
        fileMap.set(uri.toString(), { uri, diagnostics: flawDiags });
      }
    }

    // Summary item
    let totalFindings = 0;
    for (const { diagnostics } of fileMap.values()) {
      totalFindings += diagnostics.length;
    }
    items.push(new SummaryItem(totalFindings, fileMap.size));

    // Sort files by number of diagnostics (most first)
    const sortedFiles = [...fileMap.values()].sort(
      (a, b) => b.diagnostics.length - a.diagnostics.length
    );

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    for (const { uri, diagnostics } of sortedFiles) {
      // Sort diagnostics within file: errors first, then by line
      const sorted = [...diagnostics].sort((a, b) => {
        if (a.severity !== b.severity) return (a.severity ?? 0) - (b.severity ?? 0);
        return a.range.start.line - b.range.start.line;
      });
      items.push(new FileItem(uri, sorted, workspaceRoot));
    }

    return items;
  }
}
