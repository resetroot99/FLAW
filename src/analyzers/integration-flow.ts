// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
// FLAW — Integration flow analysis
// Detects siloed data systems, write-only sinks, and disconnected pipelines

import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, makeSmell, emptyResult } from './base.js';
import { extractSnippet } from '../utils/patterns.js';
import { isTestFile, isSourceFile } from '../utils/fs.js';

const srcFilter = (f: string) => isSourceFile(f) && !isTestFile(f);

export function analyzeIntegrationFlow(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  // ── 1. FK-IF-WRITESINK-001: Write-only data sink ──
  // Find DB model/table names, check if they're written but never queried outside the defining file
  const excludeModelNames = /^(log|audit|analytics?|metrics?|events?)$/i;

  // Collect all model definitions: { name, file, line }
  const models: { name: string; file: string; line: number }[] = [];

  for (const [file, content] of ctx.fileContents) {
    if (!srcFilter(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // SQLAlchemy: class X(Base), class X(db.Model)
      let m = line.match(/class\s+(\w+)\s*\(\s*(?:Base|db\.Model)\s*\)\s*:/);
      if (m && !excludeModelNames.test(m[1])) {
        models.push({ name: m[1], file, line: i + 1 });
        continue;
      }

      // SQLModel: class X(SQLModel)
      m = line.match(/class\s+(\w+)\s*\(\s*SQLModel\s*\)\s*:/);
      if (m && !excludeModelNames.test(m[1])) {
        models.push({ name: m[1], file, line: i + 1 });
        continue;
      }

      // Django: class X(models.Model)
      m = line.match(/class\s+(\w+)\s*\(\s*models\.Model\s*\)\s*:/);
      if (m && !excludeModelNames.test(m[1])) {
        models.push({ name: m[1], file, line: i + 1 });
        continue;
      }

      // Prisma: model X {
      m = line.match(/^model\s+(\w+)\s*\{/);
      if (m && !excludeModelNames.test(m[1])) {
        models.push({ name: m[1], file, line: i + 1 });
        continue;
      }
    }
  }

  // For each model, check write vs read across files (excluding the defining file)
  const writePatterns = (name: string) =>
    new RegExp(`\\b${name}\\b[^\\n]*\\.(create|add|save|insert|bulk_create|add_all)\\s*\\(|INSERT\\s+INTO\\s+["\`']?${name}`, 'i');
  const readPatterns = (name: string) =>
    new RegExp(`\\b${name}\\b[^\\n]*\\.(query|filter|find|get|select|all|objects|first|one|count|where|fetch|load|search)\\s*[.(]|SELECT\\s+[^;]*\\bFROM\\s+["\`']?${name}|\\b${name}\\.objects\\b`, 'i');

  for (const model of models) {
    let writtenOutside = false;
    let readOutside = false;

    for (const [file, content] of ctx.fileContents) {
      if (!srcFilter(file)) continue;
      if (file === model.file) continue; // skip the defining file

      const nameRe = new RegExp(`\\b${model.name}\\b`);
      if (!nameRe.test(content)) continue;

      if (writePatterns(model.name).test(content)) writtenOutside = true;
      if (readPatterns(model.name).test(content)) readOutside = true;

      if (writtenOutside && readOutside) break;
    }

    // Also check within the defining file for write/read
    const defContent = ctx.fileContents.get(model.file) || '';
    // Remove the class definition block itself — look at usages only
    if (writePatterns(model.name).test(defContent)) writtenOutside = true;
    if (readPatterns(model.name).test(defContent)) readOutside = true;

    if (writtenOutside && !readOutside) {
      result.findings.push(makeFinding({
        ruleId: 'FK-IF-WRITESINK-001',
        title: `Model "${model.name}" is written to but never queried`,
        categoryId: 'DM',
        severity: 'high',
        confidence: 'medium',
        labels: ['Incomplete', 'Dead Control'],
        summary: `"${model.name}" defined in ${model.file}:${model.line} receives writes (.create, .add, .save, INSERT) but is never queried (.filter, .get, SELECT, .objects) anywhere in the codebase.`,
        impact: 'Data is stored but never used — a write-only sink. Features depending on this data are incomplete or missing.',
        location: { file: model.file, startLine: model.line },
        codeSnippet: extractSnippet(ctx.fileContents, model.file, model.line, 0, 6),
        suggestedFix: `Add queries that read from "${model.name}" to surface this data, or remove the writes if the model is unused.`,
      }));
      result.smellHits.push(makeSmell('SMELL-WRITE-ONLY-SINK', 'Write-only data sink', 1));
    }
  }

  // ── 2. FK-IF-SILO-001: Data producer never consumed by decision logic ──
  const producerPattern = /\b(monitor|osint|intel|scraper|collector|pipeline|crawler)/i;
  const consumerPattern = /\b(score|risk|eval|assess|decision|engine)/i;

  const producerFiles: string[] = [];
  const consumerFiles: string[] = [];

  for (const file of ctx.files) {
    if (!srcFilter(file)) continue;
    const filename = file.split('/').pop() || '';
    if (producerPattern.test(filename)) producerFiles.push(file);
    if (consumerPattern.test(filename)) consumerFiles.push(file);
  }

  if (producerFiles.length > 0 && consumerFiles.length > 0) {
    // Check if any consumer imports from any producer
    const producerModuleNames = producerFiles.map(f => {
      // Extract module/directory name for import matching
      const parts = f.split('/');
      const filename = parts.pop() || '';
      const dir = parts.pop() || '';
      const baseName = filename.replace(/\.\w+$/, '');
      return { file: f, baseName, dir };
    });

    let anyProducerConsumed = false;

    for (const consumer of consumerFiles) {
      const content = ctx.fileContents.get(consumer);
      if (!content) continue;

      for (const producer of producerModuleNames) {
        // Check if consumer imports from producer (by filename or directory)
        const importRe = new RegExp(
          `(?:import|from|require)\\s*[({'"]\\.?[^'"]*\\b${producer.baseName}\\b`,
          'i'
        );
        if (importRe.test(content)) {
          anyProducerConsumed = true;
          break;
        }
      }
      if (anyProducerConsumed) break;
    }

    if (!anyProducerConsumed) {
      // Find which producers are siloed
      const producerNames = producerFiles.map(f => f.split('/').pop() || f).join(', ');
      const consumerNames = consumerFiles.map(f => f.split('/').pop() || f).join(', ');

      result.findings.push(makeFinding({
        ruleId: 'FK-IF-SILO-001',
        title: 'Data producers never consumed by decision logic',
        categoryId: 'FR',
        severity: 'medium',
        confidence: 'medium',
        labels: ['Incomplete', 'Fake Flow'],
        summary: `Producer modules [${producerNames}] exist alongside decision modules [${consumerNames}], but no consumer imports from any producer.`,
        impact: 'Data collection is disconnected from scoring/decision logic — the pipeline is siloed. Collected data never influences outcomes.',
        location: { file: producerFiles[0] },
        codeSnippet: extractSnippet(ctx.fileContents, producerFiles[0], 1, 0, 6),
        evidenceRefs: [
          ...producerFiles.map(f => `Producer: ${f}`),
          ...consumerFiles.map(f => `Consumer: ${f}`),
        ],
        suggestedFix: 'Import producer output into decision/scoring modules so collected data actually drives results.',
      }));
      result.smellHits.push(makeSmell('SMELL-DATA-SILO', 'Siloed data pipeline', 1));
    }
  }

  // ── 3. FK-IF-EVENTVOID-001: Event emitter with no subscriber ──
  // Collect all emitted event names and all subscribed event names
  const emitPatterns = /\.(?:emit|dispatch|publish|send_event|fire)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  const subscribePatterns = /\.(?:on|subscribe|listen|addEventListener|handle|addListener)\s*\(\s*['"`]([^'"`]+)['"`]/g;

  const emittedEvents = new Map<string, { file: string; line: number }[]>();
  const subscribedEvents = new Set<string>();

  for (const [file, content] of ctx.fileContents) {
    if (!srcFilter(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Collect emitted events
      let m;
      const emitRe = new RegExp(emitPatterns.source, 'g');
      while ((m = emitRe.exec(line)) !== null) {
        const eventName = m[1];
        const refs = emittedEvents.get(eventName) || [];
        refs.push({ file, line: i + 1 });
        emittedEvents.set(eventName, refs);
      }

      // Collect subscribed events
      const subRe = new RegExp(subscribePatterns.source, 'g');
      while ((m = subRe.exec(line)) !== null) {
        subscribedEvents.add(m[1]);
      }
    }
  }

  // Flag emitted events that have no subscriber
  // Skip common DOM events and framework lifecycle events
  const skipEvents = /^(click|submit|change|focus|blur|keydown|keyup|resize|scroll|load|error|close|open|message|data|end|finish|ready|connect|disconnect)$/i;

  for (const [eventName, refs] of emittedEvents) {
    if (skipEvents.test(eventName)) continue;
    if (subscribedEvents.has(eventName)) continue;

    const firstRef = refs[0];
    result.findings.push(makeFinding({
      ruleId: 'FK-IF-EVENTVOID-001',
      title: `Event "${eventName}" emitted but never subscribed to`,
      categoryId: 'FR',
      severity: 'high',
      confidence: 'medium',
      labels: ['Incomplete', 'Dead Control'],
      summary: `Event "${eventName}" is emitted ${refs.length} time(s) across the codebase but no subscriber (on/subscribe/listen/handle) was found for it.`,
      impact: 'Events fire into the void — any feature depending on this event will never trigger.',
      location: { file: firstRef.file, startLine: firstRef.line },
      codeSnippet: extractSnippet(ctx.fileContents, firstRef.file, firstRef.line, 1, 2),
      evidenceRefs: refs.slice(0, 6).map(r => `Emitted: ${r.file}:${r.line}`),
      suggestedFix: `Add a subscriber for "${eventName}" or remove the emit if the event is unused.`,
    }));
    result.smellHits.push(makeSmell('SMELL-EVENT-VOID', 'Event with no subscriber', 1));
  }

  return result;
}
