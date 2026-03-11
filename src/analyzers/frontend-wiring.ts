import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, makeSmell, emptyResult } from './base.js';
import { searchFiles, filesMatching, extractSnippet } from '../utils/patterns.js';
import { isTestFile } from '../utils/fs.js';

const uiFilter = (f: string) => /\.(tsx|jsx|vue|svelte)$/.test(f) && !isTestFile(f);

export function analyzeFrontendWiring(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  // FK-FW-BTN-001: Buttons with no handlers (HTML + component library)
  for (const [file, content] of ctx.fileContents) {
    if (!uiFilter(file)) continue;

    // Match both <button> and component library buttons: <Button, <IconButton, <Fab, <MenuItem
    const buttonRegex = /<(?:button|Button|IconButton|Fab|LoadingButton|SubmitButton)\b[^>]*>/gi;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const btnMatch = line.match(buttonRegex);
      if (!btnMatch) continue;

      for (const btn of btnMatch) {
        const hasHandler = /on(Click|Submit|Press)|type\s*=\s*['"`]submit|handleClick|handleSubmit|to\s*=|href\s*=/i.test(btn);
        const isDisabled = /disabled/i.test(btn);
        if (!hasHandler && !isDisabled) {
          // Check next few lines for closing onClick
          const region = lines.slice(i, Math.min(i + 5, lines.length)).join('\n');
          if (!/on(Click|Submit|Press)|handleClick|handleSubmit/i.test(region)) {
            result.findings.push(makeFinding({
              ruleId: 'FK-FW-BTN-001',
              title: 'Button has no effective handler',
              categoryId: 'FW',
              severity: 'high',
              confidence: 'medium',
              labels: ['Broken', 'Dead Control'],
              summary: `Button at line ${i + 1} appears to lack an action handler.`,
              impact: 'Users see a clickable button that does nothing.',
              location: { file, startLine: i + 1 },
              codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 1, 3),
              suggestedFix: 'Bind onClick or make this a type="submit" button in a form.',
            }));
          }
        }
      }
    }

    // FK-FW-FORM-001: Forms without onSubmit or action
    const formRegex = /<form[^>]*>/gi;
    for (let i = 0; i < lines.length; i++) {
      const formMatch = lines[i].match(formRegex);
      if (!formMatch) continue;

      for (const form of formMatch) {
        const hasSubmit = /on(Submit)|action\s*=/i.test(form);
        if (!hasSubmit) {
          const region = lines.slice(i, Math.min(i + 5, lines.length)).join('\n');
          if (!/on(Submit)|action\s*=/i.test(region)) {
            result.findings.push(makeFinding({
              ruleId: 'FK-FW-FORM-001',
              title: 'Form has no submit handler',
              categoryId: 'FW',
              severity: 'high',
              confidence: 'medium',
              labels: ['Broken', 'Dead Control'],
              summary: `Form at line ${i + 1} has no onSubmit or action.`,
              impact: 'Form cannot actually submit data.',
              location: { file, startLine: i + 1 },
              codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 1, 3),
              suggestedFix: 'Bind onSubmit handler or set form action.',
            }));
          }
        }
      }
    }
  }

  // FK-FW-STATE-001: console.log in handlers (dead handler smell)
  const logOnlyHandlers = searchFiles(
    ctx.fileContents,
    /(?:onClick|onSubmit|onChange|onPress)\s*=\s*\{?\s*\(\)\s*=>\s*(?:console\.log|void 0|null|undefined|\{\s*\})/i,
    uiFilter,
  );
  for (const hit of logOnlyHandlers) {
    result.findings.push(makeFinding({
      ruleId: 'FK-FW-STATE-001',
      title: 'Handler is a no-op or console.log only',
      categoryId: 'FW',
      severity: 'high',
      confidence: 'high',
      labels: ['Dead Control', 'Misleading'],
      summary: `No-op or log-only handler at ${hit.file}:${hit.line}.`,
      impact: 'Interactive control does nothing meaningful.',
      location: { file: hit.file, startLine: hit.line },
      codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line),
      suggestedFix: 'Implement the real handler or remove the control.',
    }));
    result.smellHits.push(makeSmell('SMELL-DEAD-HANDLER', 'Dead handler', 1));
  }

  // Dead links (href="#" or href="")
  const deadLinks = searchFiles(
    ctx.fileContents,
    /href\s*=\s*['"`](#|javascript:void|['"`]\s*['"`])/i,
    uiFilter,
  );
  for (const hit of deadLinks) {
    result.findings.push(makeFinding({
      ruleId: 'FK-FW-NAV-001',
      title: 'Navigation link points nowhere',
      categoryId: 'FW',
      severity: 'medium',
      confidence: 'high',
      labels: ['Dead Control', 'Incomplete'],
      summary: `Dead link at ${hit.file}:${hit.line}.`,
      impact: 'Users click a link that goes nowhere.',
      location: { file: hit.file, startLine: hit.line },
      codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line),
      suggestedFix: 'Set a real destination or remove the link.',
    }));
  }

  return result;
}
