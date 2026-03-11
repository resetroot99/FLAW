import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, emptyResult } from './base.js';
import { searchFiles, filesMatching, countPattern, extractSnippet } from '../utils/patterns.js';
import { isTestFile } from '../utils/fs.js';

const serverFilter = (f: string) => !isTestFile(f) && /\b(api|server|route|action|controller|handler|middleware|mutation)\b/i.test(f);
const srcFilter = (f: string) => !isTestFile(f) && /\.(ts|tsx|js|jsx|py|rb|go)$/.test(f);

export function analyzeValidation(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  // FK-VB-SERVER-001: Client validation exists but server lacks it
  const clientSchemaFiles = filesMatching(ctx.fileContents, /\b(zod|yup|joi|valibot|superstruct|z\.object|yup\.object|Joi\.object|formSchema|validationSchema)\b/i, (f) => !isTestFile(f) && !/\bapi\b|\bserver\b|\broute\b/i.test(f));
  const serverSchemaFiles = filesMatching(ctx.fileContents, /\b(zod|yup|joi|valibot|z\.object|yup\.object|Joi\.object|\.parse\(|\.safeParse\(|\.validate\()\b/i, serverFilter);

  if (clientSchemaFiles.length > 0 && serverSchemaFiles.length === 0) {
    // Find server files that handle mutations without validation
    const serverMutations = filesMatching(ctx.fileContents, /(POST|PUT|PATCH|DELETE|create|update|save)/i, serverFilter);
    if (serverMutations.length > 0) {
      result.findings.push(makeFinding({
        ruleId: 'FK-VB-SERVER-001',
        title: 'Client-side validation present but server-side validation absent',
        categoryId: 'VB',
        severity: 'high',
        confidence: 'medium',
        labels: ['Unsafe', 'Fragile'],
        summary: `Found ${clientSchemaFiles.length} client schema file(s) but no server-side validation in ${serverMutations.length} mutation handler(s).`,
        impact: 'Invalid data can bypass client validation and reach the server.',
        location: { file: serverMutations[0] },
        evidenceRefs: [...clientSchemaFiles.slice(0, 3).map(f => `Client schema: ${f}`), ...serverMutations.slice(0, 3).map(f => `Unvalidated mutation: ${f}`)],
        suggestedFix: 'Add server-side validation (zod, joi, etc.) to all mutation endpoints.',
      }));
    }
  }

  // FK-VB-SERVER-001: Request body used without any parsing/validation
  const rawBodyAccess = searchFiles(
    ctx.fileContents,
    /req\.body\.\w+|request\.json\(\)|await\s+req\.json\(\)/i,
    serverFilter,
  );
  for (const hit of rawBodyAccess) {
    const content = ctx.fileContents.get(hit.file)!;
    const lines = content.split('\n');
    const fileRegion = lines.slice(Math.max(0, hit.line - 15), hit.line + 5).join('\n');
    const hasValidation = /(\.parse\(|\.safeParse\(|\.validate\(|z\.\w+|Joi\.\w+|yup\.\w+|schema\.\w+|BaseModel|Pydantic|Field\(|validator\(|model_validate|TypeAdapter)/i.test(fileRegion);

    if (!hasValidation) {
      result.findings.push(makeFinding({
        ruleId: 'FK-VB-SERVER-001',
        title: 'Request body used without validation',
        categoryId: 'VB',
        severity: 'medium',
        confidence: 'medium',
        labels: ['Unsafe', 'Fragile'],
        summary: `Request body accessed at ${hit.file}:${hit.line} without visible validation.`,
        impact: 'Unvalidated input may cause runtime errors or data corruption.',
        location: { file: hit.file, startLine: hit.line },
        codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line, 3, 3),
        suggestedFix: 'Validate request body against a schema before using.',
      }));
    }
  }

  // FK-VB-UNBOUNDED-001: Pydantic models with unbounded str/list/dict fields
  const pyFilter = (f: string) => !isTestFile(f) && /\.py$/.test(f);
  for (const [file, content] of ctx.fileContents) {
    if (!pyFilter(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      // Match Pydantic Request/Input models (not Response/Out models)
      const classMatch = lines[i].match(/class\s+(\w+(?:Request|Input|Create|Update|Params|Body|Payload))\s*\(\s*(?:BaseModel|Base)\s*\)\s*:/);
      if (!classMatch) continue;
      const className = classMatch[1];
      const unboundedFields: string[] = [];

      for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
        if (/^\s*(?:class |def |@)/.test(lines[j]) && j > i + 1) break;
        const fieldLine = lines[j];
        // Match field definitions like: name: str, items: list[dict], data: dict
        const fieldMatch = fieldLine.match(/^\s+(\w+)\s*:\s*((?:str|list|dict)(?:\[.*?\])?)/);
        if (!fieldMatch) continue;
        const [, fieldName, fieldType] = fieldMatch;
        // Skip if it has Field() with constraints
        if (/Field\s*\(/.test(fieldLine) && /(max_length|max_items|ge=|le=|gt=|lt=|min_length)/.test(fieldLine)) continue;
        // Flag unbounded str, list, dict without constraints
        if (/^(str|list|dict)/.test(fieldType) && !/^(id|name|type|status|description)$/.test(fieldName)) {
          unboundedFields.push(`${fieldName}: ${fieldType}`);
        }
      }

      if (unboundedFields.length > 0) {
        result.findings.push(makeFinding({
          ruleId: 'FK-VB-UNBOUNDED-001',
          title: `${className} has ${unboundedFields.length} unbounded input field(s)`,
          categoryId: 'VB',
          severity: 'medium',
          confidence: 'medium',
          labels: ['Unsafe', 'Fragile'],
          summary: `${file}:${i + 1} — ${className} accepts [${unboundedFields.join(', ')}] without size constraints.`,
          impact: 'Allows DoS via oversized payloads. No limit on string length or list size.',
          location: { file, startLine: i + 1 },
          codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 0, Math.min(unboundedFields.length + 3, 10)),
          suggestedFix: 'Add Field(max_length=...) for strings and Field(max_items=...) for lists.',
        }));
      }
    }
  }

  // FK-VB-RAWDICT-001: FastAPI routes accepting raw dict/Any instead of Pydantic models
  for (const [file, content] of ctx.fileContents) {
    if (!pyFilter(file) || !/\b(api|route|endpoint|views)\b/i.test(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      // Match route decorators followed by function with dict/Any params
      if (!/@(?:router|app)\.(post|put|patch)\s*\(/.test(lines[i])) continue;

      // Check function signature in next few lines
      const sigBlock = lines.slice(i + 1, Math.min(i + 8, lines.length)).join('\n');
      // Strip out Depends() params — they're injected, not request body
      const sigWithoutDepends = sigBlock.replace(/\w+\s*:\s*\w+\s*=\s*Depends\([^)]*\)/g, '');
      // Also strip path params (just a type, no default) and return type
      const hasDictParam = /\w+\s*:\s*(?:dict|Dict|Any)\b(?!\s*=\s*Depends)/.test(sigWithoutDepends);
      const hasBaseModel = /\w+\s*:\s*\w+(?:Request|Input|Create|Update|Payload|Body)\b/.test(sigBlock) ||
        /BaseModel/.test(sigBlock);
      // Skip if the only dict/Any is the return type annotation
      const returnTypeOnly = /\)\s*->\s*(?:dict|Dict|Any)\b/.test(sigBlock);

      if (hasDictParam && !hasBaseModel && !returnTypeOnly) {
        result.findings.push(makeFinding({
          ruleId: 'FK-VB-RAWDICT-001',
          title: 'Mutation route accepts raw dict/Any instead of Pydantic model',
          categoryId: 'VB',
          severity: 'high',
          confidence: 'high',
          labels: ['Unsafe', 'Fragile'],
          summary: `${file}:${i + 1} accepts dict/Any — no schema validation on input.`,
          impact: 'Any JSON shape accepted. No type checking, no field constraints.',
          location: { file, startLine: i + 1 },
          codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 0, 5),
          suggestedFix: 'Define a Pydantic BaseModel for the request body.',
        }));
      }
    }
  }

  return result;
}
