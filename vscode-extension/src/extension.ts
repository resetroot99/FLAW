import * as vscode from 'vscode';
import { FlawDiagnosticsProvider } from './diagnostics';
import { FlawCodeActionProvider } from './codeActions';
import { FlawReportPanel } from './reportPanel';
import { FlawHoverProvider } from './hoverProvider';
import { FlawCodeLensProvider } from './codelens';
import { FlawTreeDataProvider } from './treeView';
import { updateInlineDecorations, clearDecorations, disposeDecorationTypes } from './inlineDecorations';

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

  // Language selector for all providers
  const selector: vscode.DocumentSelector = [
    { language: 'typescript' },
    { language: 'javascript' },
    { language: 'typescriptreact' },
    { language: 'javascriptreact' },
    { language: 'python' },
  ];

  // Code action provider
  const codeActionProvider = new FlawCodeActionProvider(diagnosticsProvider);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(selector, codeActionProvider, {
      providedCodeActionKinds: FlawCodeActionProvider.providedCodeActionKinds,
    })
  );

  // Hover provider
  const hoverProvider = new FlawHoverProvider();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, hoverProvider)
  );

  // CodeLens provider
  const codeLensProvider = new FlawCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(selector, codeLensProvider)
  );

  // Tree view
  const treeDataProvider = new FlawTreeDataProvider();
  const treeView = vscode.window.createTreeView('flawFindings', {
    treeDataProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Hook: update inline decorations and tree view when diagnostics change
  context.subscriptions.push(
    diagnosticsProvider.onDidUpdateDiagnostics((uri) => {
      // Refresh tree view
      treeDataProvider.refresh();

      // Refresh CodeLens
      codeLensProvider.refresh();

      // Update inline decorations for visible editors showing this file
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === uri.toString()) {
          const diags = vscode.languages.getDiagnostics(editor.document.uri);
          updateInlineDecorations(editor, diags);
        }
      }
    })
  );

  // Update decorations when the active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        const diags = vscode.languages.getDiagnostics(editor.document.uri);
        updateInlineDecorations(editor, diags);
      }
    })
  );

  // Update decorations when visible editors change
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        const diags = vscode.languages.getDiagnostics(editor.document.uri);
        updateInlineDecorations(editor, diags);
      }
    })
  );

  // React to config changes for inline annotations
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('flaw.showInlineAnnotations')) {
        for (const editor of vscode.window.visibleTextEditors) {
          const config = vscode.workspace.getConfiguration('flaw');
          if (config.get<boolean>('showInlineAnnotations', true)) {
            const diags = vscode.languages.getDiagnostics(editor.document.uri);
            updateInlineDecorations(editor, diags);
          } else {
            clearDecorations(editor);
          }
        }
      }
      if (e.affectsConfiguration('flaw.showCodeLens')) {
        codeLensProvider.refresh();
      }
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
    }),

    vscode.commands.registerCommand('flaw.refreshFindings', () => {
      treeDataProvider.refresh();
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

  // Clean up decoration types on deactivation
  context.subscriptions.push({ dispose: disposeDecorationTypes });

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
