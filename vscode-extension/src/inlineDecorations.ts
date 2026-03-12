import * as vscode from 'vscode';

const criticalHighDecorationType = vscode.window.createTextEditorDecorationType({
  after: {
    color: '#f85149',
    fontStyle: 'italic',
    margin: '0 0 0 2em',
  },
  backgroundColor: 'rgba(248,81,73,0.08)',
  isWholeLine: true,
});

const mediumDecorationType = vscode.window.createTextEditorDecorationType({
  after: {
    color: '#d29922',
    fontStyle: 'italic',
    margin: '0 0 0 2em',
  },
  backgroundColor: 'rgba(210,153,34,0.06)',
  isWholeLine: true,
});

const lowInfoDecorationType = vscode.window.createTextEditorDecorationType({
  after: {
    color: '#58a6ff',
    fontStyle: 'italic',
    margin: '0 0 0 2em',
  },
  backgroundColor: 'rgba(88,166,255,0.05)',
  isWholeLine: true,
});

const allDecorationTypes = [criticalHighDecorationType, mediumDecorationType, lowInfoDecorationType];

export function updateInlineDecorations(
  editor: vscode.TextEditor,
  diagnostics: readonly vscode.Diagnostic[]
): void {
  const config = vscode.workspace.getConfiguration('flaw');
  if (!config.get<boolean>('showInlineAnnotations', true)) {
    clearDecorations(editor);
    return;
  }

  const criticalHighDecorations: vscode.DecorationOptions[] = [];
  const mediumDecorations: vscode.DecorationOptions[] = [];
  const lowInfoDecorations: vscode.DecorationOptions[] = [];

  // Group diagnostics by line, picking the highest severity per line
  const lineMap = new Map<number, vscode.Diagnostic[]>();
  for (const diag of diagnostics) {
    if (diag.source !== 'FLAW') continue;
    const line = diag.range.start.line;
    if (!lineMap.has(line)) {
      lineMap.set(line, []);
    }
    lineMap.get(line)!.push(diag);
  }

  for (const [line, diags] of lineMap) {
    // Build combined message for the line
    const messages = diags.map(d => {
      const ruleId = typeof d.code === 'string' ? d.code : (d.code as { value: string })?.value || '';
      const msg = d.message.replace(/^\[[^\]]+\]\s*/, '');
      return ruleId ? `${ruleId}: ${msg}` : msg;
    });
    const combinedMessage = messages.length === 1
      ? `  \u2190 FLAW: ${messages[0]}`
      : `  \u2190 FLAW: ${messages[0]} (+${messages.length - 1} more)`;

    const lineLength = editor.document.lineAt(line).text.length;
    const range = new vscode.Range(line, lineLength, line, lineLength);

    const decoration: vscode.DecorationOptions = {
      range,
      renderOptions: {
        after: {
          contentText: combinedMessage,
        },
      },
    };

    // Pick bucket by highest severity in the group
    const hasCriticalOrHigh = diags.some(
      d => d.severity === vscode.DiagnosticSeverity.Error
    );
    const hasMedium = diags.some(
      d => d.severity === vscode.DiagnosticSeverity.Warning
    );

    if (hasCriticalOrHigh) {
      criticalHighDecorations.push(decoration);
    } else if (hasMedium) {
      mediumDecorations.push(decoration);
    } else {
      lowInfoDecorations.push(decoration);
    }
  }

  editor.setDecorations(criticalHighDecorationType, criticalHighDecorations);
  editor.setDecorations(mediumDecorationType, mediumDecorations);
  editor.setDecorations(lowInfoDecorationType, lowInfoDecorations);
}

export function clearDecorations(editor: vscode.TextEditor): void {
  for (const dt of allDecorationTypes) {
    editor.setDecorations(dt, []);
  }
}

export function disposeDecorationTypes(): void {
  for (const dt of allDecorationTypes) {
    dt.dispose();
  }
}
