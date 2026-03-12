import * as vscode from 'vscode';
import { FlawDiagnosticsProvider } from './diagnostics';

export class FlawCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private provider: FlawDiagnosticsProvider) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      if (diag.source !== 'FLAW') continue;

      // "Show suggested fix" action
      if (diag.relatedInformation && diag.relatedInformation.length > 0) {
        const fix = new vscode.CodeAction(
          `FLAW: ${diag.relatedInformation[0].message}`,
          vscode.CodeActionKind.QuickFix
        );
        fix.diagnostics = [diag];
        fix.isPreferred = false;

        // For empty catch blocks, offer to add error logging
        if (diag.code === 'FK-EH-SILENT-001') {
          const line = diag.range.start.line;
          const lineText = document.lineAt(line).text;

          if (/catch\s*\((\w+)\)\s*\{\s*\}/.test(lineText)) {
            const paramName = lineText.match(/catch\s*\((\w+)\)/)?.[1] || 'e';
            const insertAction = new vscode.CodeAction(
              `FLAW: Add console.error(${paramName}) to catch block`,
              vscode.CodeActionKind.QuickFix
            );
            insertAction.diagnostics = [diag];
            insertAction.edit = new vscode.WorkspaceEdit();

            // Replace empty catch with one that logs
            const catchMatch = lineText.match(/catch\s*\([^)]*\)\s*\{\s*\}/);
            if (catchMatch) {
              const start = lineText.indexOf(catchMatch[0]);
              insertAction.edit.replace(
                document.uri,
                new vscode.Range(line, start, line, start + catchMatch[0].length),
                `catch (${paramName}) { console.error(${paramName}); }`
              );
              actions.push(insertAction);
            }
          }
        }

        actions.push(fix);
      }

      // "View FLAW Report" action
      const reportAction = new vscode.CodeAction(
        'FLAW: View Full Report',
        vscode.CodeActionKind.QuickFix
      );
      reportAction.command = {
        command: 'flaw.showReport',
        title: 'View FLAW Report',
      };
      reportAction.diagnostics = [diag];
      actions.push(reportAction);
    }

    return actions;
  }
}
