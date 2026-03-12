import * as vscode from 'vscode';
import { FlawDiagnosticsProvider } from './diagnostics';
import { FlawCodeActionProvider } from './codeActions';
import { FlawReportPanel } from './reportPanel';

let diagnosticsProvider: FlawDiagnosticsProvider;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'flaw.showScore';
  statusBarItem.text = '$(shield) FLAW';
  statusBarItem.tooltip = 'FLAW — Flow Logic Audit Watch';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Diagnostics provider
  diagnosticsProvider = new FlawDiagnosticsProvider(statusBarItem);
  context.subscriptions.push(diagnosticsProvider);

  // Code action provider
  const codeActionProvider = new FlawCodeActionProvider(diagnosticsProvider);
  const selector = [
    { language: 'typescript' },
    { language: 'javascript' },
    { language: 'typescriptreact' },
    { language: 'javascriptreact' },
    { language: 'python' },
  ];
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(selector, codeActionProvider, {
      providedCodeActionKinds: FlawCodeActionProvider.providedCodeActionKinds,
    })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('flaw.scanFile', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        diagnosticsProvider.analyzeDocument(editor.document);
        vscode.window.showInformationMessage('FLAW: Scanned current file.');
      }
    }),

    vscode.commands.registerCommand('flaw.scanWorkspace', async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'FLAW: Scanning workspace...' },
        async () => {
          await diagnosticsProvider.analyzeWorkspace();
        }
      );
      vscode.window.showInformationMessage('FLAW: Workspace scan complete.');
    }),

    vscode.commands.registerCommand('flaw.showReport', () => {
      FlawReportPanel.show(context.extensionUri, diagnosticsProvider.getAllFindings());
    }),

    vscode.commands.registerCommand('flaw.showScore', () => {
      const findings = diagnosticsProvider.getAllFindings();
      const critical = findings.filter(f => f.severity === 'critical').length;
      const high = findings.filter(f => f.severity === 'high').length;
      const medium = findings.filter(f => f.severity === 'medium').length;
      const low = findings.filter(f => f.severity === 'low').length;
      const total = findings.length;

      const items: vscode.QuickPickItem[] = [
        { label: `$(error) ${critical} Critical`, description: 'Blocks deployment' },
        { label: `$(warning) ${high} High`, description: 'Should fix before release' },
        { label: `$(info) ${medium} Medium`, description: 'Fix when possible' },
        { label: `$(debug-hint) ${low} Low`, description: 'Nice to fix' },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: `$(list-unordered) ${total} Total Findings` },
        { label: '$(notebook) Show Full Report', description: 'Open report panel' },
        { label: '$(search) Scan Workspace', description: 'Re-scan all files' },
      ];

      vscode.window.showQuickPick(items).then(selected => {
        if (selected?.label.includes('Full Report')) {
          vscode.commands.executeCommand('flaw.showReport');
        } else if (selected?.label.includes('Scan Workspace')) {
          vscode.commands.executeCommand('flaw.scanWorkspace');
        }
      });
    })
  );

  // Auto-analyze on open and save
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => {
      if (isSupported(doc)) {
        diagnosticsProvider.analyzeDocument(doc);
      }
    }),
    vscode.workspace.onDidSaveTextDocument(doc => {
      const config = vscode.workspace.getConfiguration('flaw');
      if (config.get<boolean>('enableOnSave', true) && isSupported(doc)) {
        diagnosticsProvider.analyzeDocument(doc);
      }
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      const config = vscode.workspace.getConfiguration('flaw');
      if (config.get<boolean>('enableRealTime', false) && isSupported(e.document)) {
        diagnosticsProvider.debouncedAnalyze(e.document);
      }
    })
  );

  // Analyze already-open documents
  vscode.workspace.textDocuments.forEach(doc => {
    if (isSupported(doc)) {
      diagnosticsProvider.analyzeDocument(doc);
    }
  });
}

function isSupported(doc: vscode.TextDocument): boolean {
  return ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'python'].includes(doc.languageId);
}

export function deactivate() {
  diagnosticsProvider?.dispose();
}
