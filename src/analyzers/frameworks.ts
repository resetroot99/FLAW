// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
import type { AnalyzerContext, AnalyzerResult, Severity, Confidence, Label } from '../types/index.js';
import { makeFinding, makeSmell, emptyResult, mergeResults } from './base.js';
import { searchFiles, filesMatching, extractSnippet } from '../utils/patterns.js';
import { isTestFile } from '../utils/fs.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Rule-pack type
// ---------------------------------------------------------------------------
interface FrameworkRule {
  id: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  categoryId: string;
  labels: string[];
  pattern: string;
  crossFileCheck: boolean;
  impact: string;
  suggestedFix: string;
}

interface FrameworkRulePack {
  framework: string;
  version: string;
  rules: FrameworkRule[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const srcFilter = (f: string) => !isTestFile(f) && /\.(ts|tsx|js|jsx|py|rb)$/.test(f);
const pyFilter = (f: string) => !isTestFile(f) && /\.py$/.test(f);

function loadRulePack(name: string): FrameworkRulePack | null {
  // Resolve relative to this file's directory -> ../../rulepacks/frameworks/<name>.json
  // Support both ESM (__dirname emulation) and fallback to process.cwd()
  const bases = [
    // Works when compiled to dist/
    join(process.cwd(), 'rulepacks', 'frameworks'),
    // Works during development
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'rulepacks', 'frameworks'),
  ];
  for (const base of bases) {
    try {
      const raw = readFileSync(join(base, `${name}.json`), 'utf-8');
      return JSON.parse(raw) as FrameworkRulePack;
    } catch {
      // try next base
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------
interface DetectedFrameworks {
  nextjs: boolean;
  fastapi: boolean;
  expressPrisma: boolean;
}

function detectFrameworks(ctx: AnalyzerContext): DetectedFrameworks {
  const result: DetectedFrameworks = { nextjs: false, fastapi: false, expressPrisma: false };

  // Check package.json for JS frameworks
  if (ctx.packageJson) {
    const deps = {
      ...(ctx.packageJson.dependencies as Record<string, string> ?? {}),
      ...(ctx.packageJson.devDependencies as Record<string, string> ?? {}),
    };
    if (deps['next']) result.nextjs = true;
    if (deps['express'] || deps['prisma'] || deps['@prisma/client']) result.expressPrisma = true;
  }

  // Check for FastAPI in Python imports
  for (const [file, content] of ctx.fileContents) {
    if (!pyFilter(file)) continue;
    if (/from\s+fastapi\s+import|import\s+fastapi/i.test(content)) {
      result.fastapi = true;
      break;
    }
  }

  // Check for requirements.txt / pyproject.toml as fallback for FastAPI
  if (!result.fastapi) {
    for (const [file, content] of ctx.fileContents) {
      const basename = file.split('/').pop() ?? '';
      if (basename === 'requirements.txt' && /fastapi/i.test(content)) {
        result.fastapi = true;
        break;
      }
      if (basename === 'pyproject.toml' && /fastapi/i.test(content)) {
        result.fastapi = true;
        break;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Next.js analysis
// ---------------------------------------------------------------------------
function analyzeNextjs(ctx: AnalyzerContext): AnalyzerResult {
  const pack = loadRulePack('nextjs');
  if (!pack) return emptyResult();
  const result = emptyResult();

  // Collect all app-router page routes: app/**/page.tsx or page.js
  const pageRoutes = new Set<string>();
  for (const file of ctx.files) {
    const pageMatch = file.match(/app\/(.+?)\/page\.(tsx?|jsx?)$/);
    if (pageMatch) {
      // Convert file path to route: app/dashboard/settings/page.tsx -> /dashboard/settings
      let route = '/' + pageMatch[1];
      // Normalize dynamic segments: [slug] -> [slug] (keep as-is for matching)
      pageRoutes.add(route);
      // Also add a normalized version stripping [param] to generic form
      pageRoutes.add(route.replace(/\/\[\w+\]/g, '/[param]'));
    }
  }
  // Root page
  for (const file of ctx.files) {
    if (/app\/page\.(tsx?|jsx?)$/.test(file)) {
      pageRoutes.add('/');
    }
  }

  // FK-NX-LINK-001: Link href references route with no page
  for (const [file, content] of ctx.fileContents) {
    if (!srcFilter(file)) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const linkMatches = lines[i].matchAll(/<Link[^>]*href\s*=\s*['"`](\/[^'"`{}\s]+)['"`]/gi);
      for (const m of linkMatches) {
        const href = m[1].replace(/\?.*$/, '').replace(/\/$/, '') || '/';
        // Normalize dynamic-looking segments in the href: /users/123 -> /users/[param]
        const hrefNorm = href.replace(/\/\d+/g, '/[param]');

        const exists = pageRoutes.has(href) ||
          pageRoutes.has(hrefNorm) ||
          // Check if any page route is a prefix (catch-all routes)
          Array.from(pageRoutes).some(r => r.includes('[...') && href.startsWith(r.replace(/\/\[\.\.\.?\w+\]/, '')));

        if (!exists && pageRoutes.size > 0) {
          result.findings.push(makeFinding({
            ruleId: 'FK-NX-LINK-001',
            title: 'Link references missing route',
            categoryId: 'FW',
            severity: 'high',
            confidence: 'medium',
            labels: ['Broken', 'Dead Control'],
            summary: `<Link href="${href}"> at ${file}:${i + 1} points to a route with no page file.`,
            impact: 'Users click a link that leads to a 404 page.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1),
            suggestedFix: 'Create the missing page.tsx/page.js or fix the href to an existing route.',
          }));
        }
      }
    }
  }

  // FK-NX-SERVER-001: Server action missing 'use server'
  for (const [file, content] of ctx.fileContents) {
    if (!srcFilter(file)) continue;
    // Only check files that look like they contain server-side logic but aren't route handlers
    if (/\/api\//.test(file)) continue; // API routes don't need 'use server'
    if (/\/route\.(ts|js)x?$/.test(file)) continue; // Route handlers

    const hasServerDirective = /['"]use server['"]/m.test(content);
    if (hasServerDirective) continue;

    // Check if file uses server-only APIs
    const serverApiPattern = /(?:cookies\(\)|headers\(\)|redirect\(|revalidatePath\(|revalidateTag\()/;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (serverApiPattern.test(lines[i])) {
        // Check if this is inside an async function (likely a server action)
        const regionBefore = lines.slice(Math.max(0, i - 10), i).join('\n');
        const isInAsyncFn = /async\s+function\s+\w+/i.test(regionBefore) || /const\s+\w+\s*=\s*async/i.test(regionBefore);

        // Also flag if the file has form action patterns
        const hasFormAction = /action\s*=\s*\{/i.test(content);

        if (isInAsyncFn || hasFormAction) {
          result.findings.push(makeFinding({
            ruleId: 'FK-NX-SERVER-001',
            title: 'Server action missing \'use server\' directive',
            categoryId: 'BE',
            severity: 'high',
            confidence: 'medium',
            labels: ['Broken', 'Fake Flow'],
            summary: `File ${file} uses server-only APIs (line ${i + 1}) but lacks 'use server' directive.`,
            impact: 'Server-only APIs called on client will throw runtime errors.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 3, 2),
            suggestedFix: "Add 'use server' at the top of the file or at the beginning of each server action function.",
          }));
          result.smellHits.push(makeSmell('SMELL-BOUNDARY-VIOLATION', 'Server/client boundary violation', 1));
          break; // One finding per file
        }
      }
    }
  }

  // FK-NX-CLIENT-001: Client component importing server-only module
  const serverOnlyModules = /\bimport\b.*\bfrom\s+['"`](fs|path|crypto|net|child_process|server-only|@prisma\/client|prisma|knex|pg|mysql2?|mongodb|mongoose|drizzle-orm)['"`]/;
  for (const [file, content] of ctx.fileContents) {
    if (!srcFilter(file)) continue;
    if (!/['"]use client['"]/.test(content)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const importMatch = lines[i].match(serverOnlyModules);
      if (importMatch) {
        result.findings.push(makeFinding({
          ruleId: 'FK-NX-CLIENT-001',
          title: 'Client component imports server-only module',
          categoryId: 'FW',
          severity: 'critical',
          confidence: 'high',
          labels: ['Broken', 'Production-Blocking'],
          summary: `'use client' file ${file} imports server-only module '${importMatch[1]}' at line ${i + 1}.`,
          impact: 'Build failure or runtime crash when client bundle includes server code.',
          location: { file, startLine: i + 1 },
          codeSnippet: extractSnippet(ctx.fileContents, file, i + 1),
          suggestedFix: "Move server-only logic to a separate file without 'use client', or use the 'server-only' package.",
        }));
        result.smellHits.push(makeSmell('SMELL-BOUNDARY-VIOLATION', 'Server/client boundary violation', 1));
      }
    }
  }

  // FK-NX-MIDDLEWARE-001: middleware.ts matcher coverage
  let middlewareFile: string | undefined;
  let middlewareContent: string | undefined;
  for (const [file, content] of ctx.fileContents) {
    if (/middleware\.(ts|js)$/.test(file) && !/node_modules/.test(file)) {
      middlewareFile = file;
      middlewareContent = content;
      break;
    }
  }

  if (middlewareFile && middlewareContent) {
    // Extract matcher patterns
    const matcherMatch = middlewareContent.match(/config\s*=\s*\{[^}]*matcher\s*:\s*\[([^\]]*)\]/s);
    if (matcherMatch) {
      const matcherPatterns = matcherMatch[1];
      // Collect route paths that have auth checks in their page/layout
      const authProtectedRoutes: string[] = [];
      for (const [file, content] of ctx.fileContents) {
        if (!/app\/(.+?)\/page\.(tsx?|jsx?)$/.test(file)) continue;
        const routeMatch = file.match(/app\/(.+?)\/page\.(tsx?|jsx?)$/);
        if (!routeMatch) continue;
        const route = '/' + routeMatch[1];
        if (/(getSession|getServerSession|auth\(\)|requireAuth|redirect.*login|redirect.*signin)/i.test(content)) {
          authProtectedRoutes.push(route);
        }
      }

      for (const route of authProtectedRoutes) {
        // Check if the matcher covers this route (simple string containment or regex-like matching)
        const routeSegment = route.split('/')[1]; // first path segment
        if (routeSegment && !matcherPatterns.includes(routeSegment) && !matcherPatterns.includes(route) && !matcherPatterns.includes('/((?!')) {
          result.findings.push(makeFinding({
            ruleId: 'FK-NX-MIDDLEWARE-001',
            title: 'Middleware matcher may not cover protected route',
            categoryId: 'SA',
            severity: 'medium',
            confidence: 'low',
            labels: ['Auth Gap', 'Fragile'],
            summary: `Route ${route} has auth checks but may not be covered by middleware matcher.`,
            impact: 'Protected route may bypass middleware-level auth enforcement.',
            location: { file: middlewareFile! },
            codeSnippet: extractSnippet(ctx.fileContents, middlewareFile!, 1, 0, 10),
            suggestedFix: `Ensure middleware config.matcher includes '${route}' or a pattern that covers it.`,
          }));
        }
      }
    }
  }

  // FK-NX-BOUNDARY-001: Dynamic routes missing loading.tsx or error.tsx
  const dynamicRouteDirs = new Set<string>();
  for (const file of ctx.files) {
    const dirMatch = file.match(/^(.*\/\[\w+\])\//);
    if (dirMatch) dynamicRouteDirs.add(dirMatch[1]);
  }

  for (const dir of dynamicRouteDirs) {
    const hasPage = ctx.files.some(f => f.startsWith(dir + '/') && /page\.(tsx?|jsx?)$/.test(f));
    if (!hasPage) continue;

    const hasLoading = ctx.files.some(f => f.startsWith(dir + '/') && /loading\.(tsx?|jsx?)$/.test(f));
    const hasError = ctx.files.some(f => f.startsWith(dir + '/') && /error\.(tsx?|jsx?)$/.test(f));

    if (!hasLoading || !hasError) {
      const missing = [];
      if (!hasLoading) missing.push('loading.tsx');
      if (!hasError) missing.push('error.tsx');

      // Find the page file for location reference
      const pageFile = ctx.files.find(f => f.startsWith(dir + '/') && /page\.(tsx?|jsx?)$/.test(f));

      result.findings.push(makeFinding({
        ruleId: 'FK-NX-BOUNDARY-001',
        title: `Dynamic route missing ${missing.join(' and ')}`,
        categoryId: 'EH',
        severity: 'medium',
        confidence: 'high',
        labels: ['Fragile', 'Incomplete'],
        summary: `Dynamic route directory ${dir} is missing ${missing.join(' and ')}.`,
        impact: 'Users see raw loading flicker or unhandled error screens on dynamic pages.',
        location: { file: pageFile ?? dir + '/page.tsx' },
        suggestedFix: `Add ${missing.join(' and ')} to ${dir}/.`,
      }));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// FastAPI analysis
// ---------------------------------------------------------------------------
function analyzeFastapi(ctx: AnalyzerContext): AnalyzerResult {
  const pack = loadRulePack('fastapi');
  if (!pack) return emptyResult();
  const result = emptyResult();

  // Collect Python route files
  const routeFiles: [string, string][] = [];
  for (const [file, content] of ctx.fileContents) {
    if (!pyFilter(file)) continue;
    if (/@(?:router|app)\.(get|post|put|patch|delete)\s*\(/i.test(content)) {
      routeFiles.push([file, content]);
    }
  }

  // Collect all Pydantic model definitions across all Python files
  // model name -> set of field names
  const pydanticModels = new Map<string, Set<string>>();
  for (const [file, content] of ctx.fileContents) {
    if (!pyFilter(file)) continue;
    const lines = content.split('\n');
    let currentModel: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const classMatch = lines[i].match(/class\s+(\w+)\s*\(.*(?:BaseModel|BaseSchema|Schema)\s*.*\)\s*:/);
      if (classMatch) {
        currentModel = classMatch[1];
        pydanticModels.set(currentModel, new Set());
        continue;
      }

      if (currentModel && /^\s{4}\w/.test(lines[i]) && !/^\s{4}(class|def|#|@)/.test(lines[i])) {
        // This line is a field definition inside the model
        const fieldMatch = lines[i].match(/^\s{4}(\w+)\s*[:=]/);
        if (fieldMatch && fieldMatch[1] !== 'class' && fieldMatch[1] !== 'Config' && fieldMatch[1] !== 'model_config') {
          pydanticModels.get(currentModel)!.add(fieldMatch[1]);
        }
      }

      // End of class body (non-indented line or empty line followed by non-indented)
      if (currentModel && /^\S/.test(lines[i]) && i > 0 && !lines[i].startsWith('#')) {
        currentModel = null;
      }
    }
  }

  // FK-FA-RETURN-001: Route return doesn't match response_model fields
  for (const [file, content] of routeFiles) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const decoratorMatch = lines[i].match(/@(?:router|app)\.\w+\([^)]*response_model\s*=\s*(\w+)/);
      if (!decoratorMatch) continue;
      const modelName = decoratorMatch[1];
      const modelFields = pydanticModels.get(modelName);
      if (!modelFields || modelFields.size === 0) continue;

      // Find the return statement in the handler (scan next ~50 lines)
      for (let j = i + 1; j < Math.min(i + 50, lines.length); j++) {
        // Look for return { "key": ... } or return {"key": ...} patterns
        const returnMatch = lines[j].match(/return\s*\{/);
        if (!returnMatch) continue;

        // Gather the return dict region (up to 10 lines after)
        const returnRegion = lines.slice(j, Math.min(j + 10, lines.length)).join('\n');
        const returnKeys = new Set<string>();
        const keyMatches = returnRegion.matchAll(/['"`](\w+)['"`]\s*:/g);
        for (const km of keyMatches) {
          returnKeys.add(km[1]);
        }

        if (returnKeys.size === 0) break;

        // Check for missing required fields
        const missingFields: string[] = [];
        for (const field of modelFields) {
          if (!returnKeys.has(field)) {
            missingFields.push(field);
          }
        }

        if (missingFields.length > 0 && missingFields.length < modelFields.size) {
          result.findings.push(makeFinding({
            ruleId: 'FK-FA-RETURN-001',
            title: 'Route return may not match response_model',
            categoryId: 'BE',
            severity: 'high',
            confidence: 'low',
            labels: ['Broken', 'Schema Drift'],
            summary: `Handler in ${file}:${i + 1} declares response_model=${modelName} but return dict may be missing: ${missingFields.join(', ')}.`,
            impact: 'FastAPI will raise a validation error if required fields are missing.',
            location: { file, startLine: j + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, j + 1, 2, 4),
            suggestedFix: `Ensure return dict includes all ${modelName} fields: ${Array.from(modelFields).join(', ')}.`,
          }));
          result.smellHits.push(makeSmell('SMELL-SCHEMA-DRIFT', 'Schema drift', 1));
        }
        break;
      }
    }
  }

  // FK-FA-DEPENDS-001: Depends() references function not found in imports/definitions
  for (const [file, content] of routeFiles) {
    const lines = content.split('\n');

    // Collect all imports and local function definitions
    const definedNames = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
      // from x import a, b, c
      const fromImport = lines[i].match(/from\s+\S+\s+import\s+(.+)/);
      if (fromImport) {
        const names = fromImport[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()!.trim());
        names.forEach(n => { if (n && !n.startsWith('(')) definedNames.add(n); });
      }
      // import x
      const directImport = lines[i].match(/^import\s+(\w+)/);
      if (directImport) definedNames.add(directImport[1]);
      // def func_name
      const funcDef = lines[i].match(/^(?:async\s+)?def\s+(\w+)/);
      if (funcDef) definedNames.add(funcDef[1]);
      // var = ...
      const varDef = lines[i].match(/^(\w+)\s*=/);
      if (varDef) definedNames.add(varDef[1]);
    }

    // Find Depends() calls
    for (let i = 0; i < lines.length; i++) {
      const dependsMatches = lines[i].matchAll(/Depends\(\s*(\w+)\s*\)/g);
      for (const dm of dependsMatches) {
        const depName = dm[1];
        if (!definedNames.has(depName)) {
          result.findings.push(makeFinding({
            ruleId: 'FK-FA-DEPENDS-001',
            title: 'Depends() references function not found in imports',
            categoryId: 'BE',
            severity: 'high',
            confidence: 'medium',
            labels: ['Broken', 'Fake Flow'],
            summary: `Depends(${depName}) at ${file}:${i + 1} references a callable not imported or defined in this file.`,
            impact: 'FastAPI dependency injection will fail — endpoint will crash.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1),
            suggestedFix: `Import '${depName}' or define it in this file.`,
          }));
        }
      }
    }
  }

  // FK-FA-RESPONSE-001: POST/PUT endpoint missing response_model
  for (const [file, content] of routeFiles) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const routeMatch = lines[i].match(/@(?:router|app)\.(post|put)\s*\(/);
      if (!routeMatch) continue;
      // Check the decorator line and next line for response_model
      const decoratorRegion = lines.slice(i, Math.min(i + 3, lines.length)).join('\n');
      if (!/response_model\s*=/.test(decoratorRegion)) {
        // Skip if the route returns a simple Response or RedirectResponse
        const handlerRegion = lines.slice(i, Math.min(i + 20, lines.length)).join('\n');
        if (/return\s+(Response|RedirectResponse|JSONResponse|HTMLResponse|StreamingResponse|FileResponse)\s*\(/.test(handlerRegion)) continue;
        // Skip status_code=204 (no content) or 201 with Location header
        if (/status_code\s*=\s*204/.test(decoratorRegion)) continue;

        result.findings.push(makeFinding({
          ruleId: 'FK-FA-RESPONSE-001',
          title: `${routeMatch[1].toUpperCase()} endpoint missing response_model`,
          categoryId: 'BE',
          severity: 'low',
          confidence: 'medium',
          labels: ['Incomplete'],
          summary: `${routeMatch[1].toUpperCase()} route at ${file}:${i + 1} has no response_model.`,
          impact: 'No OpenAPI documentation for this write endpoint. Cosmetic — does not affect functionality.',
          location: { file, startLine: i + 1 },
          codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 0, 3),
          suggestedFix: 'Add response_model=YourPydanticModel to the route decorator.',
        }));
      }
    }
  }

  // FK-FA-CORS-001: CORS wildcard origins
  for (const [file, content] of ctx.fileContents) {
    if (!pyFilter(file)) continue;
    if (!/CORSMiddleware/.test(content)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/CORSMiddleware/.test(lines[i])) continue;
      // Gather the middleware config region
      const region = lines.slice(i, Math.min(i + 15, lines.length)).join('\n');
      if (/allow_origins\s*=\s*\[\s*['"`]\*['"`]\s*\]/.test(region)) {
        result.findings.push(makeFinding({
          ruleId: 'FK-FA-CORS-001',
          title: 'CORS allows all origins',
          categoryId: 'SA',
          severity: 'high',
          confidence: 'high',
          labels: ['Unsafe', 'Fragile'],
          summary: `CORSMiddleware at ${file}:${i + 1} uses allow_origins=["*"].`,
          impact: 'Any website can make authenticated cross-origin requests to your API.',
          location: { file, startLine: i + 1 },
          codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 1, 8),
          suggestedFix: "Replace '*' with specific allowed origins. Use environment variables for different environments.",
        }));
      }
      break;
    }
  }

  // FK-FA-ASYNC-001: Async issues in background tasks and route handlers
  for (const [file, content] of routeFiles) {
    const lines = content.split('\n');

    // Check for non-awaited async calls in route handlers
    for (let i = 0; i < lines.length; i++) {
      // Detect add_task with a function name
      const taskMatch = lines[i].match(/\.add_task\(\s*(\w+)/);
      if (!taskMatch) continue;
      const taskFuncName = taskMatch[1];

      // Check if the task function is async in any file
      let taskIsAsync = false;
      let taskExists = false;
      for (const [, c] of ctx.fileContents) {
        if (!pyFilter) continue;
        if (new RegExp(`async\\s+def\\s+${taskFuncName}\\s*\\(`).test(c)) {
          taskIsAsync = true;
          taskExists = true;
          break;
        }
        if (new RegExp(`def\\s+${taskFuncName}\\s*\\(`).test(c)) {
          taskExists = true;
          // don't break — might find async version
        }
      }

      if (taskExists && !taskIsAsync) {
        // Check if the function does I/O (network, db, file)
        for (const [, c] of ctx.fileContents) {
          const funcMatch = c.match(new RegExp(`def\\s+${taskFuncName}\\s*\\([^)]*\\)\\s*:([\\s\\S]*?)(?=\\ndef |\\nclass |$)`));
          if (!funcMatch) continue;
          const funcBody = funcMatch[1];
          if (/(requests\.|httpx\.|aiohttp|fetch|urlopen|prisma\.|db\.|session\.|cursor\.|open\()/.test(funcBody)) {
            result.findings.push(makeFinding({
              ruleId: 'FK-FA-ASYNC-001',
              title: 'Background task function does I/O but is not async',
              categoryId: 'BE',
              severity: 'medium',
              confidence: 'medium',
              labels: ['Fragile', 'Silent Failure'],
              summary: `Background task '${taskFuncName}' referenced at ${file}:${i + 1} does I/O but is not async.`,
              impact: 'Synchronous I/O in background tasks blocks the event loop.',
              location: { file, startLine: i + 1 },
              codeSnippet: extractSnippet(ctx.fileContents, file, i + 1),
              suggestedFix: `Make '${taskFuncName}' async and use async I/O libraries.`,
            }));
          }
          break;
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Express + Prisma analysis
// ---------------------------------------------------------------------------
function analyzeExpressPrisma(ctx: AnalyzerContext): AnalyzerResult {
  const pack = loadRulePack('express-prisma');
  if (!pack) return emptyResult();
  const result = emptyResult();

  const jsFilter = (f: string) => !isTestFile(f) && /\.(ts|tsx|js|jsx)$/.test(f);

  // Collect Prisma schema fields if schema.prisma exists
  // model name -> set of field names
  const prismaModels = new Map<string, Set<string>>();
  for (const [file, content] of ctx.fileContents) {
    if (!file.endsWith('schema.prisma')) continue;
    const lines = content.split('\n');
    let currentModel: string | null = null;

    for (const line of lines) {
      const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
      if (modelMatch) {
        currentModel = modelMatch[1];
        prismaModels.set(currentModel, new Set());
        continue;
      }
      if (currentModel && line.trim() === '}') {
        currentModel = null;
        continue;
      }
      if (currentModel) {
        const fieldMatch = line.match(/^\s+(\w+)\s+/);
        if (fieldMatch && !['@@', '//'].some(p => line.trim().startsWith(p))) {
          prismaModels.set(currentModel, prismaModels.get(currentModel)!.add(fieldMatch[1]));
        }
      }
    }
  }

  // FK-EP-SCHEMA-001: Prisma query references field not in schema
  if (prismaModels.size > 0) {
    for (const [file, content] of ctx.fileContents) {
      if (!jsFilter(file)) continue;
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        // Match prisma.modelName.findMany/create/update/etc.
        const queryMatch = lines[i].match(/prisma\.(\w+)\.(findMany|findFirst|findUnique|create|update|delete|upsert)\s*\(/);
        if (!queryMatch) continue;

        const modelName = queryMatch[1];
        // Prisma uses camelCase model access (User -> user, BlogPost -> blogPost)
        // Try to find matching model (case-insensitive first char match)
        const modelKey = Array.from(prismaModels.keys()).find(
          k => k.toLowerCase() === modelName.toLowerCase() ||
               k.charAt(0).toLowerCase() + k.slice(1) === modelName
        );
        if (!modelKey) continue;
        const fields = prismaModels.get(modelKey)!;

        // Gather the query region (where, select, data, orderBy)
        const queryRegion = lines.slice(i, Math.min(i + 20, lines.length)).join('\n');

        // Extract field references from where, select, data, orderBy blocks
        const fieldRefs = new Set<string>();
        const refMatches = queryRegion.matchAll(/(?:where|select|data|orderBy)\s*:\s*\{([^}]*)\}/gs);
        for (const rm of refMatches) {
          const blockContent = rm[1];
          const fieldNames = blockContent.matchAll(/(\w+)\s*:/g);
          for (const fn of fieldNames) {
            // Skip Prisma operators (contains, in, not, gt, lt, etc.)
            if (['contains', 'in', 'not', 'gt', 'gte', 'lt', 'lte', 'equals', 'startsWith', 'endsWith', 'mode', 'has', 'every', 'some', 'none', 'is', 'isNot', 'AND', 'OR', 'NOT', 'true', 'false', 'include', 'select', 'take', 'skip', 'cursor', 'distinct'].includes(fn[1])) continue;
            fieldRefs.add(fn[1]);
          }
        }

        for (const ref of fieldRefs) {
          if (!fields.has(ref)) {
            result.findings.push(makeFinding({
              ruleId: 'FK-EP-SCHEMA-001',
              title: 'Prisma query may reference field not in schema',
              categoryId: 'DM',
              severity: 'high',
              confidence: 'low',
              labels: ['Broken', 'Schema Drift'],
              summary: `Prisma query on '${modelKey}' at ${file}:${i + 1} references field '${ref}' not found in schema.prisma.`,
              impact: 'Prisma client will throw an unknown field error at runtime.',
              location: { file, startLine: i + 1 },
              codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 1, 6),
              suggestedFix: `Check schema.prisma model '${modelKey}' for correct field names. Run 'prisma generate' after changes.`,
            }));
            result.smellHits.push(makeSmell('SMELL-SCHEMA-DRIFT', 'Schema drift', 1));
          }
        }
      }
    }
  }

  // FK-EP-ORDER-001: Route handler registered before auth middleware
  for (const [file, content] of ctx.fileContents) {
    if (!jsFilter(file)) continue;
    // Only check files that have both route registrations and middleware setup
    if (!/app\.(get|post|put|patch|delete)\s*\(/.test(content)) continue;
    if (!/app\.use\s*\(/.test(content)) continue;

    const lines = content.split('\n');
    let firstRouteLine = -1;
    let authMiddlewareLine = -1;

    for (let i = 0; i < lines.length; i++) {
      // Find first route handler
      if (firstRouteLine === -1 && /app\.(get|post|put|patch|delete)\s*\(/.test(lines[i])) {
        firstRouteLine = i;
      }
      // Find auth middleware
      if (authMiddlewareLine === -1 && /app\.use\s*\([^)]*(?:passport|jwt|auth|session|isAuthenticated|requireAuth|verifyToken|protect)/i.test(lines[i])) {
        authMiddlewareLine = i;
      }
    }

    if (firstRouteLine !== -1 && authMiddlewareLine !== -1 && firstRouteLine < authMiddlewareLine) {
      result.findings.push(makeFinding({
        ruleId: 'FK-EP-ORDER-001',
        title: 'Route handler registered before auth middleware',
        categoryId: 'SA',
        severity: 'high',
        confidence: 'medium',
        labels: ['Auth Gap', 'Unsafe'],
        summary: `In ${file}, route at line ${firstRouteLine + 1} is registered before auth middleware at line ${authMiddlewareLine + 1}.`,
        impact: 'Routes registered before auth middleware are unprotected.',
        location: { file, startLine: firstRouteLine + 1 },
        codeSnippet: extractSnippet(ctx.fileContents, file, firstRouteLine + 1, 1, 3),
        suggestedFix: 'Move app.use(authMiddleware) before all protected route registrations.',
      }));
    }
  }

  // FK-EP-BODY-001: req.body accessed without validation middleware
  for (const [file, content] of ctx.fileContents) {
    if (!jsFilter(file)) continue;
    if (!/req\.body/.test(content)) continue;

    // Check if file/project uses any validation library
    const hasValidation =
      /(express-validator|validationResult|check\(|body\(|param\(|query\()/.test(content) ||
      /(zod|z\.object|z\.string|z\.number|\.parse\(|\.safeParse\()/.test(content) ||
      /(joi|Joi\.object|Joi\.string|celebrate|validator)/.test(content) ||
      /(yup|yup\.object|\.validate\()/.test(content) ||
      /(class-validator|IsString|IsNumber|IsEmail|ValidateNested)/.test(content);

    if (hasValidation) continue;

    // Also check if there's a global validation middleware in project
    let hasGlobalValidation = false;
    for (const [otherFile, otherContent] of ctx.fileContents) {
      if (/middleware/i.test(otherFile) && /(express-validator|zod|joi|yup|celebrate|class-validator)/i.test(otherContent)) {
        hasGlobalValidation = true;
        break;
      }
    }
    if (hasGlobalValidation) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/req\.body\.(\w+)|req\.body\[/.test(lines[i])) {
        result.findings.push(makeFinding({
          ruleId: 'FK-EP-BODY-001',
          title: 'req.body accessed without validation middleware',
          categoryId: 'VB',
          severity: 'medium',
          confidence: 'medium',
          labels: ['Unsafe', 'Fragile'],
          summary: `req.body accessed at ${file}:${i + 1} without visible validation middleware.`,
          impact: 'Unvalidated request body can cause crashes or injection attacks.',
          location: { file, startLine: i + 1 },
          codeSnippet: extractSnippet(ctx.fileContents, file, i + 1),
          suggestedFix: 'Add validation middleware (express-validator, zod, joi) before the route handler.',
        }));
        break; // One finding per file
      }
    }
  }

  // FK-EP-INCLUDE-001: Prisma relation access without include
  if (prismaModels.size > 0) {
    // Collect relation fields from schema (fields referencing other models)
    const relationFields = new Map<string, Set<string>>();
    for (const [file, content] of ctx.fileContents) {
      if (!file.endsWith('schema.prisma')) continue;
      const lines = content.split('\n');
      let currentModel: string | null = null;

      for (const line of lines) {
        const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
        if (modelMatch) {
          currentModel = modelMatch[1];
          relationFields.set(currentModel, new Set());
          continue;
        }
        if (currentModel && line.trim() === '}') {
          currentModel = null;
          continue;
        }
        if (currentModel) {
          // Relation fields: fieldName ModelName or fieldName ModelName[] or fieldName ModelName?
          const relMatch = line.match(/^\s+(\w+)\s+([A-Z]\w+)[\[\]?]*/);
          if (relMatch) {
            const fieldName = relMatch[1];
            const typeName = relMatch[2];
            // If the type is another model in the schema, it's a relation
            if (prismaModels.has(typeName)) {
              relationFields.get(currentModel)!.add(fieldName);
            }
          }
        }
      }
    }

    for (const [file, content] of ctx.fileContents) {
      if (!jsFilter(file)) continue;
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const queryMatch = lines[i].match(/prisma\.(\w+)\.(findMany|findFirst|findUnique)\s*\(/);
        if (!queryMatch) continue;
        const modelName = queryMatch[1];
        const modelKey = Array.from(relationFields.keys()).find(
          k => k.toLowerCase() === modelName.toLowerCase() ||
               k.charAt(0).toLowerCase() + k.slice(1) === modelName
        );
        if (!modelKey) continue;
        const relations = relationFields.get(modelKey)!;
        if (relations.size === 0) continue;

        // Check the query for include
        const queryRegion = lines.slice(i, Math.min(i + 15, lines.length)).join('\n');
        const hasInclude = /include\s*:/.test(queryRegion);
        const hasSelect = /select\s*:/.test(queryRegion);

        if (hasInclude || hasSelect) continue;

        // Now check if relation fields are accessed on the result in surrounding code
        // Look ahead for .relationName access
        const accessRegion = lines.slice(i, Math.min(i + 30, lines.length)).join('\n');
        for (const rel of relations) {
          const accessPattern = new RegExp(`\\.${rel}\\b(?!\\s*:)`);
          if (accessPattern.test(accessRegion)) {
            result.findings.push(makeFinding({
              ruleId: 'FK-EP-INCLUDE-001',
              title: 'Prisma relation accessed without include',
              categoryId: 'DM',
              severity: 'high',
              confidence: 'medium',
              labels: ['Broken', 'Silent Failure'],
              summary: `Query on '${modelKey}' at ${file}:${i + 1} accesses relation '${rel}' but query has no include.`,
              impact: `Accessing '${rel}' without include returns undefined — Prisma does not lazy-load.`,
              location: { file, startLine: i + 1 },
              codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 1, 8),
              suggestedFix: `Add include: { ${rel}: true } to the Prisma query.`,
            }));
            result.smellHits.push(makeSmell('SMELL-DISCONNECTED-BACKEND', 'Disconnected backend', 1));
            break;
          }
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export function analyzeFrameworks(ctx: AnalyzerContext): AnalyzerResult {
  const detected = detectFrameworks(ctx);

  const results: AnalyzerResult[] = [];

  if (detected.nextjs) {
    results.push(analyzeNextjs(ctx));
  }
  if (detected.fastapi) {
    results.push(analyzeFastapi(ctx));
  }
  if (detected.expressPrisma) {
    results.push(analyzeExpressPrisma(ctx));
  }

  if (results.length === 0) return emptyResult();
  return mergeResults(...results);
}
