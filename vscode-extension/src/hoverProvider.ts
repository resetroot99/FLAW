import * as vscode from 'vscode';

const CATEGORY_MAP: Record<string, string> = {
  'FK-EH': 'Error Handling',
  'FK-FW': 'Frontend Wiring',
  'FK-FR': 'Feature Reality',
  'FK-SA': 'Security & Auth',
  'FK-MH': 'Maintainability',
  'FK-DM': 'Data Model',
  'FK-BI': 'Backend Integrity',
  'FK-DP': 'Deployment',
  'FK-TS': 'Testing',
  'FK-VB': 'Validation',
  'FK-WR': 'Wiring',
  'FK-SM': 'Code Smells',
};

const SEVERITY_ICON: Record<string, string> = {
  critical: '\u274c',
  high: '\u26a0\ufe0f',
  medium: '\u26a1',
  low: '\u2139\ufe0f',
  info: '\ud83d\udca1',
};

function categoryFromRuleId(ruleId: string): string {
  const prefix = ruleId.split('-').slice(0, 2).join('-');
  return CATEGORY_MAP[prefix] || 'General';
}

function severityFromDiagnostic(diag: vscode.Diagnostic): string {
  switch (diag.severity) {
    case vscode.DiagnosticSeverity.Error: return 'high';
    case vscode.DiagnosticSeverity.Warning: return 'medium';
    case vscode.DiagnosticSeverity.Information: return 'low';
    case vscode.DiagnosticSeverity.Hint: return 'info';
    default: return 'medium';
  }
}

export class FlawHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | undefined {
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    const flawDiags = diagnostics.filter(
      d => d.source === 'FLAW' && d.range.contains(position)
    );

    if (flawDiags.length === 0) return undefined;

    const parts: vscode.MarkdownString[] = [];

    for (const diag of flawDiags) {
      const ruleId = typeof diag.code === 'string'
        ? diag.code
        : (diag.code as { value: string | number })?.value?.toString() || '';
      const severity = severityFromDiagnostic(diag);
      const sevUpper = severity.toUpperCase();
      const icon = SEVERITY_ICON[severity] || '\u26a0\ufe0f';
      const category = categoryFromRuleId(ruleId);

      // Extract the title from the diagnostic message (strip label prefix)
      const title = diag.message.replace(/^\[[^\]]+\]\s*/, '');

      // Get the fix suggestion from relatedInformation
      const fix = diag.relatedInformation?.[0]?.message || 'Review and fix the issue.';

      // Get the summary from the diagnostic message
      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      md.supportHtml = true;

      md.appendMarkdown(`${icon} **FLAW: ${ruleId}**\n\n`);
      md.appendMarkdown(`**${title}**\n\n`);

      // Add a separator
      md.appendMarkdown(`---\n\n`);

      // Fix suggestion
      md.appendMarkdown(`**Fix:** ${fix}\n\n`);

      // Metadata line
      md.appendMarkdown(`Severity: \`${sevUpper}\` | Category: \`${category}\``);

      parts.push(md);
    }

    return new vscode.Hover(parts);
  }
}
