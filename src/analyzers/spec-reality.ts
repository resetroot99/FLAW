// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, makeSmell, emptyResult } from './base.js';
import { searchFiles, extractSnippet } from '../utils/patterns.js';
import { isTestFile } from '../utils/fs.js';

const srcFilter = (f: string) => !isTestFile(f) && /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|java|php)$/.test(f);

// ---------------------------------------------------------------------------
// Minimal YAML path extraction (no dependency)
// Handles OpenAPI specs where paths appear as top-level-ish keys like:
//   paths:
//     /api/users:
//       get:
//       post:
// ---------------------------------------------------------------------------
interface SpecEndpoint {
  path: string;
  method: string;
}

function parseOpenApiJson(raw: string): SpecEndpoint[] {
  const endpoints: SpecEndpoint[] = [];
  try {
    const spec = JSON.parse(raw);
    const paths = spec.paths || {};
    for (const [path, methods] of Object.entries(paths)) {
      if (typeof methods !== 'object' || methods === null) continue;
      for (const method of Object.keys(methods as Record<string, unknown>)) {
        const m = method.toLowerCase();
        if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(m)) {
          endpoints.push({ path, method: m.toUpperCase() });
        }
      }
    }
  } catch {
    // Malformed JSON — silently skip
  }
  return endpoints;
}

function parseOpenApiYaml(raw: string): SpecEndpoint[] {
  const endpoints: SpecEndpoint[] = [];
  const lines = raw.split('\n');

  // State machine: find `paths:` section, then indent-based keys
  let inPaths = false;
  let pathsIndent = -1;
  let currentPath = '';
  let pathIndent = -1;

  for (const line of lines) {
    // Skip comments and blank lines
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;

    const indent = line.search(/\S/);

    // Detect `paths:` top-level key
    if (/^paths\s*:/.test(line.trimStart()) && indent <= 2) {
      inPaths = true;
      pathsIndent = indent;
      continue;
    }

    if (!inPaths) continue;

    // If we hit another top-level key at same or lower indent as paths, we're done
    if (indent <= pathsIndent && line.trim() !== '' && !line.trim().startsWith('#')) {
      // Check it's a key (has colon)
      if (/:/.test(line) && !/^\s*-/.test(line)) {
        inPaths = false;
        continue;
      }
    }

    // Path key: e.g. `  /api/users:`
    const pathMatch = line.match(/^(\s+)(\/[^:\s]*)\s*:/);
    if (pathMatch && inPaths) {
      const pIndent = pathMatch[1].length;
      if (pIndent > pathsIndent) {
        currentPath = pathMatch[2];
        pathIndent = pIndent;
        continue;
      }
    }

    // Method key under a path: e.g. `    get:`
    if (currentPath && indent > pathIndent) {
      const methodMatch = line.match(/^\s+(get|post|put|patch|delete|options|head)\s*:/i);
      if (methodMatch) {
        endpoints.push({ path: currentPath, method: methodMatch[1].toUpperCase() });
      }
    }

    // If indent goes back to or below path indent with a new key, reset currentPath
    if (indent <= pathIndent && currentPath && /:/.test(line) && !/^\s*#/.test(line)) {
      const nextPath = line.match(/^(\s+)(\/[^:\s]*)\s*:/);
      if (nextPath && nextPath[1].length === pathIndent) {
        currentPath = nextPath[2];
      } else if (indent <= pathsIndent) {
        currentPath = '';
        inPaths = false;
      }
    }
  }

  return endpoints;
}

// ---------------------------------------------------------------------------
// Route handler extraction from code (Express, FastAPI, Next.js, etc.)
// ---------------------------------------------------------------------------
interface CodeRoute {
  path: string;
  method: string;
  file: string;
  line: number;
}

function extractCodeRoutes(ctx: AnalyzerContext): CodeRoute[] {
  const routes: CodeRoute[] = [];

  for (const [file, content] of ctx.fileContents) {
    if (isTestFile(file)) continue;

    const lines = content.split('\n');

    // Collect router prefix for FastAPI
    let routerPrefix = '';
    const prefixMatch = content.match(/APIRouter\s*\(\s*(?:.*?)prefix\s*=\s*['"`]([^'"`]+)['"`]/);
    if (prefixMatch) routerPrefix = prefixMatch[1];

    // Also collect Express router mount prefix: app.use('/api/v1', router)
    // This is best-effort since mounting can be complex
    const expressMountMatch = content.match(/app\.use\(\s*['"`](\/[^'"`]+)['"`]\s*,\s*\w+Router/);
    let expressPrefix = '';
    if (expressMountMatch) expressPrefix = expressMountMatch[1];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // FastAPI: @router.get("/path") or @app.post("/path")
      const fastapiMatch = line.match(/@(?:router|app)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/i);
      if (fastapiMatch) {
        routes.push({
          path: routerPrefix + fastapiMatch[2],
          method: fastapiMatch[1].toUpperCase(),
          file,
          line: i + 1,
        });
        continue;
      }

      // Express: router.get("/path", ...) or app.post("/path", ...)
      const expressMatch = line.match(/(?:router|app)\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]+)['"`]/i);
      if (expressMatch) {
        routes.push({
          path: expressPrefix + expressMatch[2],
          method: expressMatch[1].toUpperCase(),
          file,
          line: i + 1,
        });
        continue;
      }

      // Next.js App Router: export async function GET/POST/PUT/PATCH/DELETE
      if (/\/api\//.test(file) && /\.(ts|js)$/.test(file)) {
        const nextMatch = line.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/);
        if (nextMatch) {
          // Derive path from file: app/api/users/route.ts -> /api/users
          const pathMatch = file.match(/(?:app|pages)(\/api\/.+?)(?:\/route|\/index)?\.\w+$/);
          if (pathMatch) {
            routes.push({
              path: pathMatch[1],
              method: nextMatch[1].toUpperCase(),
              file,
              line: i + 1,
            });
          }
        }
      }

      // Flask: @app.route("/path", methods=["GET", "POST"])
      const flaskMatch = line.match(/@\w+\.route\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?/i);
      if (flaskMatch) {
        const path = flaskMatch[1];
        const methods = flaskMatch[2]
          ? flaskMatch[2].replace(/['"`\s]/g, '').split(',')
          : ['GET'];
        for (const m of methods) {
          routes.push({ path, method: m.toUpperCase(), file, line: i + 1 });
        }
      }
    }
  }

  // Next.js Pages Router file-based routes (pages/api/*)
  for (const file of ctx.files) {
    if (!/pages\/api\//.test(file)) continue;
    if (isTestFile(file)) continue;
    const pathMatch = file.match(/pages(\/api\/.+?)(?:\/index)?\.\w+$/);
    if (pathMatch) {
      const content = ctx.fileContents.get(file);
      if (!content) continue;
      // Default export = handler that responds to multiple methods
      if (/export\s+default/.test(content)) {
        // Check which methods are referenced
        const methods: string[] = [];
        if (/req\.method\s*===?\s*['"`]GET/i.test(content) || !/req\.method/.test(content)) methods.push('GET');
        if (/req\.method\s*===?\s*['"`]POST/i.test(content)) methods.push('POST');
        if (/req\.method\s*===?\s*['"`]PUT/i.test(content)) methods.push('PUT');
        if (/req\.method\s*===?\s*['"`]PATCH/i.test(content)) methods.push('PATCH');
        if (/req\.method\s*===?\s*['"`]DELETE/i.test(content)) methods.push('DELETE');
        if (methods.length === 0) methods.push('GET');
        for (const m of methods) {
          routes.push({ path: pathMatch[1], method: m, file, line: 1 });
        }
      }
    }
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Normalize paths for comparison
// ---------------------------------------------------------------------------
function normalizePath(p: string): string {
  return p
    .replace(/\/+$/, '')           // trim trailing slash
    .replace(/\{[^}]+\}/g, ':p')  // {id} -> :p
    .replace(/:\w+/g, ':p')       // :id -> :p
    .replace(/\/\d+/g, '/:p')     // /123 -> /:p
    .toLowerCase();
}

function pathsMatch(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

// ---------------------------------------------------------------------------
// Check 1: OpenAPI / Swagger verification
// ---------------------------------------------------------------------------
function checkOpenApi(ctx: AnalyzerContext, result: AnalyzerResult): void {
  // Find spec files
  const specFiles: { file: string; format: 'json' | 'yaml' }[] = [];
  for (const file of ctx.files) {
    const lower = file.toLowerCase();
    const name = lower.split('/').pop() || '';
    if (/^(openapi|swagger)\.(json)$/.test(name)) {
      specFiles.push({ file, format: 'json' });
    } else if (/^(openapi|swagger)\.(ya?ml)$/.test(name)) {
      specFiles.push({ file, format: 'yaml' });
    }
  }

  if (specFiles.length === 0) return;

  // Parse all spec endpoints
  const specEndpoints: SpecEndpoint[] = [];
  let specFile = '';

  for (const { file, format } of specFiles) {
    const content = ctx.fileContents.get(file);
    if (!content) continue;
    specFile = file;
    const parsed = format === 'json'
      ? parseOpenApiJson(content)
      : parseOpenApiYaml(content);
    specEndpoints.push(...parsed);
  }

  if (specEndpoints.length === 0) return;

  // Build lookup set from spec
  const specSet = new Set(specEndpoints.map(e => `${e.method} ${normalizePath(e.path)}`));

  // Extract code routes
  const codeRoutes = extractCodeRoutes(ctx);
  const codeSet = new Set(codeRoutes.map(r => `${r.method} ${normalizePath(r.path)}`));

  // Spec-defined but no handler in code
  for (const ep of specEndpoints) {
    const key = `${ep.method} ${normalizePath(ep.path)}`;
    if (!codeSet.has(key)) {
      result.findings.push(makeFinding({
        ruleId: 'FK-SR-OPENAPI-001',
        title: `Spec endpoint missing from code: ${ep.method} ${ep.path}`,
        categoryId: 'BE',
        severity: 'high',
        confidence: 'medium',
        labels: ['Incomplete', 'Fake Flow'],
        summary: `OpenAPI spec defines ${ep.method} ${ep.path} but no matching route handler was found in the codebase.`,
        impact: 'API consumers expect this endpoint to exist. Requests will 404.',
        location: { file: specFile },
        suggestedFix: `Implement a handler for ${ep.method} ${ep.path} or remove it from the spec.`,
      }));
      result.smellHits.push(makeSmell('SMELL-HALLUCINATED-REFERENCE', 'Hallucinated spec reference', 1));
    }
  }

  // Code routes not documented in spec
  for (const route of codeRoutes) {
    const key = `${route.method} ${normalizePath(route.path)}`;
    if (!specSet.has(key)) {
      // Only flag if the route looks like an API route (starts with /api or /)
      if (!route.path.startsWith('/')) continue;
      result.findings.push(makeFinding({
        ruleId: 'FK-SR-OPENAPI-001',
        title: `Route handler not in OpenAPI spec: ${route.method} ${route.path}`,
        categoryId: 'BE',
        severity: 'medium',
        confidence: 'medium',
        labels: ['Incomplete', 'Unverified'],
        summary: `Route handler ${route.method} ${route.path} exists in code but is not documented in the OpenAPI spec.`,
        impact: 'Undocumented endpoints are harder for consumers to discover and may lack contract validation.',
        location: { file: route.file, startLine: route.line },
        codeSnippet: extractSnippet(ctx.fileContents, route.file, route.line),
        suggestedFix: `Add ${route.method} ${route.path} to the OpenAPI spec.`,
      }));
      result.smellHits.push(makeSmell('SMELL-FAKE-INTEGRATION', 'Undocumented route', 1));
    }
  }
}

// ---------------------------------------------------------------------------
// Check 2: Prisma schema verification
// ---------------------------------------------------------------------------
function checkPrisma(ctx: AnalyzerContext, result: AnalyzerResult): void {
  // Find Prisma schema files
  let prismaFile = '';
  let prismaContent = '';
  for (const [file, content] of ctx.fileContents) {
    if (/prisma\/schema\.prisma$/.test(file) || /schema\.prisma$/.test(file)) {
      prismaFile = file;
      prismaContent = content;
      break;
    }
  }

  if (!prismaFile) return;

  // Extract model names
  const modelRegex = /^model\s+(\w+)\s*\{/gm;
  const models: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = modelRegex.exec(prismaContent)) !== null) {
    models.push(match[1]);
  }

  if (models.length === 0) return;

  // For each model, check if there's corresponding code
  for (const model of models) {
    const modelLower = model.toLowerCase();
    let hasUsage = false;

    // Check 1: Prisma client calls like prisma.user.findMany(), prisma.user.create()
    const prismaClientPattern = new RegExp(
      `prisma\\.${modelLower}\\.(?:findMany|findUnique|findFirst|create|update|delete|upsert|count|aggregate)` +
      `|prisma\\.${modelLower}\\b`,
      'i'
    );

    // Check 2: Route/service files named after the model
    const fileNamePattern = new RegExp(
      `(?:^|/)${modelLower}(?:s|es)?(?:\\.|/)` +
      `|(?:^|/)${modelLower}(?:s|es)?[-_]?(?:route|controller|service|handler|api)`,
      'i'
    );

    // Check 3: Generic ORM calls referencing the model name
    const genericPattern = new RegExp(
      `['"\`]${model}['"\`]` +
      `|model:\\s*['"\`]${model}['"\`]` +
      `|\\b${model}\\.(?:findMany|findUnique|create|update|delete|find|save|destroy)\\b`,
      'i'
    );

    for (const [file, content] of ctx.fileContents) {
      if (isTestFile(file)) continue;
      if (file === prismaFile) continue;

      if (prismaClientPattern.test(content) || genericPattern.test(content)) {
        hasUsage = true;
        break;
      }

      if (fileNamePattern.test(file)) {
        hasUsage = true;
        break;
      }
    }

    if (!hasUsage) {
      result.findings.push(makeFinding({
        ruleId: 'FK-SR-PRISMA-001',
        title: `Prisma model '${model}' has no CRUD routes or service layer`,
        categoryId: 'DM',
        severity: 'medium',
        confidence: 'medium',
        labels: ['Incomplete', 'Schema Drift'],
        summary: `Prisma model '${model}' is defined in the schema but no corresponding CRUD routes, service functions, or Prisma client calls were found.`,
        impact: 'Schema defines a data model that the application never uses — possible dead schema or incomplete feature.',
        location: { file: prismaFile },
        suggestedFix: `Implement CRUD operations for the '${model}' model or remove it from the schema if unused.`,
      }));
      result.smellHits.push(makeSmell('SMELL-HALLUCINATED-REFERENCE', 'Unused Prisma model', 1));
    }
  }
}

// ---------------------------------------------------------------------------
// Check 3: GraphQL schema verification
// ---------------------------------------------------------------------------
function checkGraphQL(ctx: AnalyzerContext, result: AnalyzerResult): void {
  // Find GraphQL schema definitions
  const queryFields: { name: string; file: string; line: number }[] = [];
  const mutationFields: { name: string; file: string; line: number }[] = [];

  for (const [file, content] of ctx.fileContents) {
    if (isTestFile(file)) continue;

    // .graphql/.gql files or files containing type Query/Mutation (e.g. in template literals)
    const isGraphqlFile = /\.(graphql|gql)$/.test(file);
    const hasTypeDefs = /type\s+(Query|Mutation)\s*\{/.test(content);
    if (!isGraphqlFile && !hasTypeDefs) continue;

    const lines = content.split('\n');
    let inType: 'Query' | 'Mutation' | null = null;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect type Query { or type Mutation {
      const typeMatch = line.match(/type\s+(Query|Mutation)\s*\{/);
      if (typeMatch) {
        inType = typeMatch[1] as 'Query' | 'Mutation';
        braceDepth = 1;
        // Check if fields are on the same line after {
        const afterBrace = line.slice(line.indexOf('{') + 1);
        const fieldMatch = afterBrace.match(/(\w+)\s*(?:\(|:)/);
        if (fieldMatch) {
          const target = inType === 'Query' ? queryFields : mutationFields;
          target.push({ name: fieldMatch[1], file, line: i + 1 });
        }
        continue;
      }

      if (inType) {
        // Track braces
        for (const ch of line) {
          if (ch === '{') braceDepth++;
          if (ch === '}') braceDepth--;
        }

        if (braceDepth <= 0) {
          inType = null;
          continue;
        }

        // Extract field name: `  getUser(id: ID!): User`
        const fieldMatch = line.match(/^\s+(\w+)\s*(?:\(|:)/);
        if (fieldMatch && !fieldMatch[1].startsWith('_')) {
          const target = inType === 'Query' ? queryFields : mutationFields;
          target.push({ name: fieldMatch[1], file, line: i + 1 });
        }
      }
    }
  }

  const allFields = [...queryFields, ...mutationFields];
  if (allFields.length === 0) return;

  // Build set of resolver function names found in code
  const resolverNames = new Set<string>();

  for (const [file, content] of ctx.fileContents) {
    if (isTestFile(file)) continue;
    // Skip the GraphQL schema files themselves
    if (/\.(graphql|gql)$/.test(file)) continue;

    const lines = content.split('\n');
    for (const line of lines) {
      // Common resolver patterns:
      // 1. Object key: `getUser: async (parent, args) =>`  or  `getUser(parent, args) {`
      // 2. Function: `function getUser(` or `async function getUser(`
      // 3. Resolver map: `getUser: getUser` or `getUser: resolvers.getUser`
      // 4. Class method: `async getUser(`
      const keyMatch = line.match(/^\s*(\w+)\s*(?::\s*(?:async\s*)?\(|[\(]\s*(?:parent|root|obj|_|args|context|ctx|info))/);
      if (keyMatch) resolverNames.add(keyMatch[1]);

      const funcMatch = line.match(/(?:async\s+)?function\s+(\w+)/);
      if (funcMatch) resolverNames.add(funcMatch[1]);

      const arrowMatch = line.match(/(?:const|let|var|export\s+(?:const|let))\s+(\w+)\s*=\s*(?:async\s*)?\(/);
      if (arrowMatch) resolverNames.add(arrowMatch[1]);
    }
  }

  // Check each field
  for (const field of allFields) {
    if (!resolverNames.has(field.name)) {
      const kind = queryFields.includes(field) ? 'query' : 'mutation';
      result.findings.push(makeFinding({
        ruleId: 'FK-SR-GRAPHQL-001',
        title: `GraphQL ${kind} '${field.name}' has no corresponding resolver`,
        categoryId: 'BE',
        severity: 'high',
        confidence: 'medium',
        labels: ['Broken', 'Fake Flow'],
        summary: `GraphQL schema defines ${kind} '${field.name}' but no matching resolver function was found.`,
        impact: `Calling this ${kind} will fail at runtime or return null.`,
        location: { file: field.file, startLine: field.line },
        codeSnippet: extractSnippet(ctx.fileContents, field.file, field.line),
        suggestedFix: `Implement a resolver for '${field.name}' or remove it from the schema.`,
      }));
      result.smellHits.push(makeSmell('SMELL-HALLUCINATED-REFERENCE', 'Unresolved GraphQL field', 1));
    }
  }
}

// ---------------------------------------------------------------------------
// Check 4: Environment variable verification
// ---------------------------------------------------------------------------
function checkEnvVars(ctx: AnalyzerContext, result: AnalyzerResult): void {
  // Find .env.example or .env.sample
  let envFile = '';
  let envContent = '';
  for (const [file, content] of ctx.fileContents) {
    const name = file.split('/').pop() || '';
    if (/^\.env\.(example|sample)$/.test(name)) {
      envFile = file;
      envContent = content;
      break;
    }
  }

  if (!envFile) return;

  // Extract variable names from .env.example
  const envVars = new Set<string>();
  const lines = envContent.split('\n');
  for (const line of lines) {
    // Skip comments and blank lines
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;
    const varMatch = line.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
    if (varMatch) {
      envVars.add(varMatch[1]);
    }
  }

  if (envVars.size === 0) return;

  // Collect all env var references from code
  const referencedVars = new Set<string>();
  const undocumentedRefs: { varName: string; file: string; line: number }[] = [];

  for (const [file, content] of ctx.fileContents) {
    if (isTestFile(file)) continue;
    const name = file.split('/').pop() || '';
    // Skip env files themselves
    if (/^\.env/.test(name)) continue;

    const fileLines = content.split('\n');
    for (let i = 0; i < fileLines.length; i++) {
      const fileLine = fileLines[i];

      // process.env.VAR_NAME
      const processEnvMatches = fileLine.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g);
      for (const m of processEnvMatches) {
        referencedVars.add(m[1]);
        if (!envVars.has(m[1])) {
          undocumentedRefs.push({ varName: m[1], file, line: i + 1 });
        }
      }

      // process.env['VAR_NAME'] or process.env["VAR_NAME"]
      const bracketMatches = fileLine.matchAll(/process\.env\[['"`]([A-Z_][A-Z0-9_]*)['"`]\]/g);
      for (const m of bracketMatches) {
        referencedVars.add(m[1]);
        if (!envVars.has(m[1])) {
          undocumentedRefs.push({ varName: m[1], file, line: i + 1 });
        }
      }

      // Python: os.environ.get('VAR'), os.getenv('VAR'), os.environ['VAR']
      const pyEnvMatches = fileLine.matchAll(/os\.(?:environ\.get|getenv|environ)\[?\s*\(?['"`]([A-Z_][A-Z0-9_]*)['"`]\)?/g);
      for (const m of pyEnvMatches) {
        referencedVars.add(m[1]);
        if (!envVars.has(m[1])) {
          undocumentedRefs.push({ varName: m[1], file, line: i + 1 });
        }
      }

      // Vite/import.meta.env.VITE_VAR
      const vitaMatches = fileLine.matchAll(/import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g);
      for (const m of vitaMatches) {
        referencedVars.add(m[1]);
        if (!envVars.has(m[1])) {
          undocumentedRefs.push({ varName: m[1], file, line: i + 1 });
        }
      }
    }
  }

  // Flag env vars defined in .env.example but never referenced in code
  for (const varName of envVars) {
    if (!referencedVars.has(varName)) {
      result.findings.push(makeFinding({
        ruleId: 'FK-SR-ENV-001',
        title: `Env var '${varName}' defined but never used`,
        categoryId: 'DO',
        severity: 'medium',
        confidence: 'medium',
        labels: ['Incomplete', 'Dead Control'],
        summary: `Environment variable '${varName}' is defined in ${envFile} but never referenced in the codebase.`,
        impact: 'Dead configuration creates confusion for developers setting up the project.',
        location: { file: envFile },
        suggestedFix: `Remove '${varName}' from ${envFile} if it's no longer needed, or use it in the code.`,
      }));
      result.smellHits.push(makeSmell('SMELL-HALLUCINATED-REFERENCE', 'Unused env var in example', 1));
    }
  }

  // Flag code references to env vars not in .env.example (deduplicate by var name)
  const flaggedUndocumented = new Set<string>();
  for (const ref of undocumentedRefs) {
    if (flaggedUndocumented.has(ref.varName)) continue;
    flaggedUndocumented.add(ref.varName);

    // Skip common built-in vars that don't need documentation
    if (/^(NODE_ENV|HOME|PATH|PWD|USER|SHELL|TERM|LANG|CI|DEBUG|PORT|HOST|HOSTNAME|TZ)$/.test(ref.varName)) continue;

    result.findings.push(makeFinding({
      ruleId: 'FK-SR-ENV-001',
      title: `Env var '${ref.varName}' used but not documented`,
      categoryId: 'DO',
      severity: 'high',
      confidence: 'medium',
      labels: ['Incomplete', 'Unverified'],
      summary: `Code references process.env.${ref.varName} but it's not documented in ${envFile}.`,
      impact: 'New developers will miss this required configuration, causing runtime failures.',
      location: { file: ref.file, startLine: ref.line },
      codeSnippet: extractSnippet(ctx.fileContents, ref.file, ref.line),
      suggestedFix: `Add '${ref.varName}' to ${envFile} with a description or placeholder value.`,
    }));
    result.smellHits.push(makeSmell('SMELL-FAKE-INTEGRATION', 'Undocumented env var', 1));
  }
}

// ---------------------------------------------------------------------------
// Main analyzer export
// ---------------------------------------------------------------------------
export function analyzeSpecReality(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  checkOpenApi(ctx, result);
  checkPrisma(ctx, result);
  checkGraphQL(ctx, result);
  checkEnvVars(ctx, result);

  return result;
}
