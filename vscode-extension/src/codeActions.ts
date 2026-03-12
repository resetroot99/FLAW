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

      const ruleId = typeof diag.code === 'string'
        ? diag.code
        : (diag.code as { value: string | number })?.value?.toString() || '';

      // ── FK-EH-SILENT-001: Empty catch block ──
      if (ruleId === 'FK-EH-SILENT-001') {
        const line = diag.range.start.line;
        const lineText = document.lineAt(line).text;

        // Single-line empty catch: catch(e) {}
        const singleLineMatch = lineText.match(/catch\s*\((\w+)\)\s*\{\s*\}/);
        if (singleLineMatch) {
          const paramName = singleLineMatch[1];
          const insertAction = new vscode.CodeAction(
            `FLAW: Add console.error(${paramName}) to catch block`,
            vscode.CodeActionKind.QuickFix
          );
          insertAction.diagnostics = [diag];
          insertAction.isPreferred = true;
          insertAction.edit = new vscode.WorkspaceEdit();
          const start = lineText.indexOf(singleLineMatch[0]);
          insertAction.edit.replace(
            document.uri,
            new vscode.Range(line, start, line, start + singleLineMatch[0].length),
            `catch (${paramName}) { console.error('Operation failed:', ${paramName}); }`
          );
          actions.push(insertAction);
        }

        // Multi-line empty catch: catch(e) {\n}
        const multiLineMatch = lineText.match(/catch\s*\((\w+)\)\s*\{\s*$/);
        if (multiLineMatch && line + 1 < document.lineCount) {
          const nextLine = document.lineAt(line + 1).text;
          if (/^\s*\}/.test(nextLine)) {
            const paramName = multiLineMatch[1];
            const indent = nextLine.match(/^(\s*)/)?.[1] || '  ';
            const insertAction = new vscode.CodeAction(
              `FLAW: Add error logging to catch block`,
              vscode.CodeActionKind.QuickFix
            );
            insertAction.diagnostics = [diag];
            insertAction.isPreferred = true;
            insertAction.edit = new vscode.WorkspaceEdit();
            insertAction.edit.insert(
              document.uri,
              new vscode.Position(line + 1, 0),
              `${indent}  console.error('Operation failed:', ${paramName});\n`
            );
            actions.push(insertAction);
          }
        }

        // Catch with only console.log — upgrade to console.error
        if (/catch\s*\((\w+)\)\s*\{/.test(lineText) && !/\{\s*\}/.test(lineText)) {
          for (let j = line + 1; j < Math.min(line + 4, document.lineCount); j++) {
            const bodyLine = document.lineAt(j).text;
            const logMatch = bodyLine.match(/console\.(log|warn)\(/);
            if (logMatch) {
              const upgradeAction = new vscode.CodeAction(
                `FLAW: Upgrade console.${logMatch[1]} to console.error`,
                vscode.CodeActionKind.QuickFix
              );
              upgradeAction.diagnostics = [diag];
              upgradeAction.edit = new vscode.WorkspaceEdit();
              upgradeAction.edit.replace(
                document.uri,
                new vscode.Range(j, bodyLine.indexOf(`console.${logMatch[1]}`), j, bodyLine.indexOf(`console.${logMatch[1]}`) + `console.${logMatch[1]}`.length),
                'console.error'
              );
              actions.push(upgradeAction);
              break;
            }
          }
        }
      }

      // ── FK-EH-SILENT-002: Python except pass ──
      if (ruleId === 'FK-EH-SILENT-002') {
        const line = diag.range.start.line;
        const lineText = document.lineAt(line).text;
        const indent = lineText.match(/^(\s*)/)?.[1] || '';

        // except: pass or except Exception: pass — add logging
        if (/:\s*pass\s*$/.test(lineText)) {
          const addLogging = new vscode.CodeAction(
            'FLAW: Replace pass with logging',
            vscode.CodeActionKind.QuickFix
          );
          addLogging.diagnostics = [diag];
          addLogging.isPreferred = true;
          addLogging.edit = new vscode.WorkspaceEdit();

          // Change "except Exception: pass" to "except Exception as e:\n    logger.error(...)"
          const exceptMatch = lineText.match(/^(\s*except\s*(?:\w+)?)(?:\s+as\s+\w+)?:\s*pass\s*$/);
          if (exceptMatch) {
            const exceptPart = exceptMatch[1];
            addLogging.edit.replace(
              document.uri,
              new vscode.Range(line, 0, line, lineText.length),
              `${exceptPart} as e:\n${indent}    import logging; logging.exception("Unexpected error: %s", e)`
            );
            actions.push(addLogging);
          }
        } else {
          // Multi-line: except...\n    pass
          for (let j = line + 1; j < Math.min(line + 5, document.lineCount); j++) {
            const bodyLine = document.lineAt(j).text.trim();
            if (bodyLine === 'pass') {
              const bodyIndent = document.lineAt(j).text.match(/^(\s*)/)?.[1] || '    ';
              const addLogging = new vscode.CodeAction(
                'FLAW: Replace pass with logging',
                vscode.CodeActionKind.QuickFix
              );
              addLogging.diagnostics = [diag];
              addLogging.isPreferred = true;
              addLogging.edit = new vscode.WorkspaceEdit();
              addLogging.edit.replace(
                document.uri,
                new vscode.Range(j, 0, j, document.lineAt(j).text.length),
                `${bodyIndent}import logging; logging.exception("Unexpected error")`
              );
              actions.push(addLogging);
              break;
            }
            if (bodyLine !== '' && !bodyLine.startsWith('#')) break;
          }
        }
      }

      // ── FK-FR-MOCK-001: Mock data in production path ──
      if (ruleId === 'FK-FR-MOCK-001') {
        const line = diag.range.start.line;
        const lineText = document.lineAt(line).text;

        // Check for mock data variable references
        const mockMatch = lineText.match(/\b(mockData|fakeData|dummyData|sampleData|testData|placeholderData|placeholderItems|placeholderList)\b/i);
        if (mockMatch) {
          const replaceAction = new vscode.CodeAction(
            `FLAW: Replace ${mockMatch[1]} with TODO fetch call`,
            vscode.CodeActionKind.QuickFix
          );
          replaceAction.diagnostics = [diag];
          replaceAction.edit = new vscode.WorkspaceEdit();
          const idx = lineText.indexOf(mockMatch[1]);
          replaceAction.edit.replace(
            document.uri,
            new vscode.Range(line, idx, line, idx + mockMatch[1].length),
            `/* TODO: Replace with real data fetch */ []`
          );
          actions.push(replaceAction);
        }
      }

      // ── FK-FW-BTN-001: Button without handler ──
      if (ruleId === 'FK-FW-BTN-001') {
        const line = diag.range.start.line;
        const lineText = document.lineAt(line).text;

        const btnMatch = lineText.match(/<(button|Button|IconButton|Fab|LoadingButton|SubmitButton)\b([^>]*?)>/i);
        if (btnMatch) {
          const addHandler = new vscode.CodeAction(
            'FLAW: Add onClick handler to button',
            vscode.CodeActionKind.QuickFix
          );
          addHandler.diagnostics = [diag];
          addHandler.edit = new vscode.WorkspaceEdit();
          // Insert onClick before the closing >
          const tagEnd = lineText.indexOf('>', lineText.indexOf(btnMatch[0]));
          if (tagEnd >= 0) {
            addHandler.edit.insert(
              document.uri,
              new vscode.Position(line, tagEnd),
              ` onClick={() => { /* TODO: implement handler */ }}`
            );
            actions.push(addHandler);
          }
        }
      }

      // ── FK-FW-FORM-001: Form without onSubmit ──
      if (ruleId === 'FK-FW-FORM-001') {
        const line = diag.range.start.line;
        const lineText = document.lineAt(line).text;

        const formMatch = lineText.match(/<form\b([^>]*?)>/i);
        if (formMatch) {
          const addSubmit = new vscode.CodeAction(
            'FLAW: Add onSubmit handler to form',
            vscode.CodeActionKind.QuickFix
          );
          addSubmit.diagnostics = [diag];
          addSubmit.edit = new vscode.WorkspaceEdit();
          const tagEnd = lineText.indexOf('>', lineText.indexOf(formMatch[0]));
          if (tagEnd >= 0) {
            addSubmit.edit.insert(
              document.uri,
              new vscode.Position(line, tagEnd),
              ` onSubmit={(e) => { e.preventDefault(); /* TODO: implement submit */ }}`
            );
            actions.push(addSubmit);
          }
        }
      }

      // ── FK-FW-STATE-001: No-op handler ──
      if (ruleId === 'FK-FW-STATE-001') {
        const line = diag.range.start.line;
        const lineText = document.lineAt(line).text;

        const noopMatch = lineText.match(/(on(?:Click|Submit|onChange|onPress))\s*=\s*\{?\s*\(\)\s*=>\s*(?:console\.log\([^)]*\)|void 0|null|undefined|\{\s*\})/i);
        if (noopMatch) {
          const fixAction = new vscode.CodeAction(
            'FLAW: Replace no-op with TODO handler',
            vscode.CodeActionKind.QuickFix
          );
          fixAction.diagnostics = [diag];
          fixAction.edit = new vscode.WorkspaceEdit();
          const matchStart = lineText.indexOf(noopMatch[0]);
          fixAction.edit.replace(
            document.uri,
            new vscode.Range(line, matchStart, line, matchStart + noopMatch[0].length),
            `${noopMatch[1]}={() => { /* TODO: implement real handler */ }}`
          );
          actions.push(fixAction);
        }
      }

      // ── FK-SA-INPUT-001: dangerouslySetInnerHTML / v-html / innerHTML ──
      if (ruleId === 'FK-SA-INPUT-001') {
        const line = diag.range.start.line;
        const addSanitize = new vscode.CodeAction(
          'FLAW: Add sanitization TODO comment',
          vscode.CodeActionKind.QuickFix
        );
        addSanitize.diagnostics = [diag];
        addSanitize.edit = new vscode.WorkspaceEdit();
        const indent = document.lineAt(line).text.match(/^(\s*)/)?.[1] || '';
        addSanitize.edit.insert(
          document.uri,
          new vscode.Position(line, 0),
          `${indent}// TODO: SECURITY — Sanitize HTML content before rendering (use DOMPurify or similar)\n`
        );
        actions.push(addSanitize);
      }

      // ── FK-SA-SECRET-001: Hardcoded secret ──
      if (ruleId === 'FK-SA-SECRET-001') {
        const line = diag.range.start.line;
        const lineText = document.lineAt(line).text;

        const envAction = new vscode.CodeAction(
          'FLAW: Replace with environment variable reference',
          vscode.CodeActionKind.QuickFix
        );
        envAction.diagnostics = [diag];
        envAction.edit = new vscode.WorkspaceEdit();

        // Try to extract the variable name
        const varMatch = lineText.match(/(?:const|let|var)\s+(\w+)\s*=\s*['"`]/) ||
                         lineText.match(/(\w+)\s*[:=]\s*['"`]/);
        const varName = varMatch?.[1] || 'SECRET';
        const envName = varName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();

        // Detect if it's a TS/JS file
        const isJs = /\.(ts|tsx|js|jsx)$/.test(document.uri.fsPath);
        const replacement = isJs
          ? `process.env.${envName}`
          : `os.environ["${envName}"]`;

        // Replace the string value
        const strMatch = lineText.match(/['"`][^'"`\s]{8,}['"`]/);
        if (strMatch) {
          const idx = lineText.indexOf(strMatch[0]);
          envAction.edit.replace(
            document.uri,
            new vscode.Range(line, idx, line, idx + strMatch[0].length),
            replacement
          );
          actions.push(envAction);
        }
      }

      // ── FK-FR-STUB-001: Python stub function ──
      if (ruleId === 'FK-FR-STUB-001') {
        const line = diag.range.start.line;
        const lineText = document.lineAt(line).text;
        const indent = lineText.match(/^(\s*)/)?.[1] || '';
        const funcName = lineText.match(/def\s+(\w+)/)?.[1] || 'function';

        const addTodo = new vscode.CodeAction(
          `FLAW: Add implementation TODO for ${funcName}`,
          vscode.CodeActionKind.QuickFix
        );
        addTodo.diagnostics = [diag];
        addTodo.edit = new vscode.WorkspaceEdit();

        // Find the "pass" or "raise NotImplementedError" line and replace it
        for (let j = line + 1; j < Math.min(line + 10, document.lineCount); j++) {
          const bodyLine = document.lineAt(j).text.trim();
          if (bodyLine === '' || bodyLine.startsWith('#') || bodyLine.startsWith('"""') || bodyLine.startsWith("'''")) continue;
          if (bodyLine === 'pass' || /raise\s+NotImplementedError/.test(bodyLine)) {
            const bodyIndent = document.lineAt(j).text.match(/^(\s*)/)?.[1] || '    ';
            addTodo.edit.replace(
              document.uri,
              new vscode.Range(j, 0, j, document.lineAt(j).text.length),
              `${bodyIndent}raise NotImplementedError("TODO: Implement ${funcName}")`
            );
            actions.push(addTodo);
            break;
          }
          break;
        }
      }

      // ── FK-FR-CLAIM-001: TODO in critical path ──
      if (ruleId === 'FK-FR-CLAIM-001') {
        const line = diag.range.start.line;
        const lineText = document.lineAt(line).text;

        const highlightAction = new vscode.CodeAction(
          'FLAW: Convert TODO to tracked issue comment',
          vscode.CodeActionKind.QuickFix
        );
        highlightAction.diagnostics = [diag];
        highlightAction.edit = new vscode.WorkspaceEdit();

        // Replace the TODO comment with a more visible tracked format
        const commentMatch = lineText.match(/(\/\/|#)\s*(TODO|FIXME|HACK|TEMP|XXX|PLACEHOLDER)\b(.*)/i);
        if (commentMatch) {
          const prefix = commentMatch[1];
          const tag = commentMatch[2].toUpperCase();
          const rest = commentMatch[3];
          const idx = lineText.indexOf(commentMatch[0]);
          highlightAction.edit.replace(
            document.uri,
            new vscode.Range(line, idx, line, idx + commentMatch[0].length),
            `${prefix} [FLAW-TRACKED] ${tag}:${rest} — THIS IS IN A CRITICAL PATH`
          );
          actions.push(highlightAction);
        }
      }

      // ── FK-MH-DEADCODE-001: Commented-out code ──
      if (ruleId === 'FK-MH-DEADCODE-001') {
        const removeAction = new vscode.CodeAction(
          'FLAW: Remove all commented-out code lines',
          vscode.CodeActionKind.QuickFix
        );
        removeAction.diagnostics = [diag];
        removeAction.edit = new vscode.WorkspaceEdit();

        // Find and remove all commented-out code lines
        const codeCommentRe = /^\s*\/\/\s*(const|let|var|function|if|for|while|return|import|export|class)\b/;
        const edits: vscode.Range[] = [];

        for (let j = 0; j < document.lineCount; j++) {
          if (codeCommentRe.test(document.lineAt(j).text)) {
            edits.push(new vscode.Range(j, 0, j + 1, 0));
          }
        }

        for (const editRange of edits) {
          removeAction.edit.delete(document.uri, editRange);
        }

        if (edits.length > 0) {
          actions.push(removeAction);
        }
      }

      // "Show suggested fix" action (generic, for all rules)
      if (diag.relatedInformation && diag.relatedInformation.length > 0) {
        const fix = new vscode.CodeAction(
          `FLAW: ${diag.relatedInformation[0].message}`,
          vscode.CodeActionKind.QuickFix
        );
        fix.diagnostics = [diag];
        fix.isPreferred = false;
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
