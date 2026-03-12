import * as vscode from 'vscode';

/**
 * Regex patterns to detect function/class definitions.
 * Matches: function X(, const X = (, let X = (, var X = (, def X(, class X, export default function, async function, etc.
 */
const FUNC_PATTERNS = [
  // JS/TS: function declarations
  /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(/,
  // JS/TS: arrow functions assigned to const/let/var
  /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/,
  // JS/TS: method-style arrow / function expression
  /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\b/,
  // Python: def
  /(?:async\s+)?def\s+(\w+)\s*\(/,
  // Class declarations
  /(?:export\s+(?:default\s+)?)?class\s+(\w+)/,
];

interface FuncLocation {
  name: string;
  line: number;
}

function findFunctionDefinitions(document: vscode.TextDocument): FuncLocation[] {
  const results: FuncLocation[] = [];
  const lineCount = document.lineCount;

  for (let i = 0; i < lineCount; i++) {
    const lineText = document.lineAt(i).text;

    for (const pattern of FUNC_PATTERNS) {
      const match = pattern.exec(lineText);
      if (match && match[1]) {
        results.push({ name: match[1], line: i });
        break; // Only match one pattern per line
      }
    }
  }

  return results;
}

/**
 * For a given function starting at `funcLine`, determine which lines belong to it.
 * Uses a simple heuristic: from funcLine to the line before the next function definition
 * (or end of file).
 */
function getFunctionRange(funcLine: number, allFuncLines: number[], lineCount: number): { start: number; end: number } {
  const idx = allFuncLines.indexOf(funcLine);
  const nextFuncLine = idx < allFuncLines.length - 1 ? allFuncLines[idx + 1] : lineCount;
  return { start: funcLine, end: nextFuncLine - 1 };
}

export class FlawCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const config = vscode.workspace.getConfiguration('flaw');
    if (!config.get<boolean>('showCodeLens', true)) {
      return [];
    }

    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    const flawDiags = diagnostics.filter(d => d.source === 'FLAW');

    if (flawDiags.length === 0) return [];

    const funcs = findFunctionDefinitions(document);
    if (funcs.length === 0) return [];

    const allFuncLines = funcs.map(f => f.line);
    const lenses: vscode.CodeLens[] = [];

    for (const func of funcs) {
      const { start, end } = getFunctionRange(func.line, allFuncLines, document.lineCount);

      // Find diagnostics that fall within this function's range
      const funcDiags = flawDiags.filter(d => {
        const diagLine = d.range.start.line;
        return diagLine >= start && diagLine <= end;
      });

      if (funcDiags.length === 0) continue;

      // Find the first diagnostic line for the "go to" command
      const firstDiagLine = Math.min(...funcDiags.map(d => d.range.start.line));

      const range = new vscode.Range(func.line, 0, func.line, 0);
      const label = funcDiags.length === 1
        ? '\u26a0 1 FLAW finding'
        : `\u26a0 ${funcDiags.length} FLAW findings`;

      const lens = new vscode.CodeLens(range, {
        title: label,
        command: 'revealLine',
        arguments: [{ lineNumber: firstDiagLine, at: 'center' }],
      });

      lenses.push(lens);
    }

    return lenses;
  }
}
