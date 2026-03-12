// FLAW — Cross-file wiring verification
// Catches broken imports, phantom exports, missing route handlers, and undefined event handlers
// across file boundaries using enhanced regex (no AST, no native deps)

import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, makeSmell, emptyResult } from './base.js';
import { extractSnippet } from '../utils/patterns.js';
import { isTestFile, isSourceFile } from '../utils/fs.js';

const SKIP_DIRS = /(?:^|\/)(?:node_modules|\.next|\.nuxt|dist|build|\.svelte-kit|coverage|__pycache__|\.git|vendor|target)\//;

const srcFilter = (f: string) => isSourceFile(f) && !isTestFile(f) && !SKIP_DIRS.test(f);
const jstsFilter = (f: string) => /\.(tsx?|jsx?|mjs|cjs)$/.test(f) && srcFilter(f);
const uiFilter = (f: string) => /\.(tsx|jsx|vue|svelte)$/.test(f) && !isTestFile(f) && !SKIP_DIRS.test(f);
const serverFilter = (f: string) =>
  srcFilter(f) && /\b(api|server|route|routes|action|controller|handler|middleware|mutation|views|endpoints|pages\/api|app\/api)\b/i.test(f);

// ─────────────────────────────────────────────────────────
// Path alias resolution
// ─────────────────────────────────────────────────────────

interface PathAlias {
  prefix: string;      // e.g. "@/"
  targets: string[];   // e.g. ["src/"]
}

function loadPathAliases(ctx: AnalyzerContext): PathAlias[] {
  const aliases: PathAlias[] = [];

  // Check tsconfig.json / tsconfig.app.json for compilerOptions.paths
  for (const [file, content] of ctx.fileContents) {
    if (!/tsconfig.*\.json$/.test(file)) continue;
    try {
      // Strip comments from JSON (tsconfig allows them)
      const cleaned = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const parsed = JSON.parse(cleaned);
      const paths = parsed?.compilerOptions?.paths;
      const baseUrl = parsed?.compilerOptions?.baseUrl || '.';
      if (paths && typeof paths === 'object') {
        for (const [alias, targets] of Object.entries(paths)) {
          if (!Array.isArray(targets)) continue;
          // Convert TS path pattern to prefix: "@/*" -> "@/"
          const prefix = alias.replace(/\*$/, '');
          const resolvedTargets = (targets as string[]).map(t => {
            const target = t.replace(/\*$/, '');
            // Combine baseUrl + target
            if (baseUrl === '.') return target;
            return `${baseUrl.replace(/\/$/, '')}/${target}`;
          });
          aliases.push({ prefix, targets: resolvedTargets });
        }
      }
    } catch {
      // Malformed tsconfig — skip
    }
  }

  // Check next.config.js/mjs for webpack alias (rare but possible)
  // Not worth the complexity — tsconfig.paths covers 99% of cases

  return aliases;
}

function resolveAlias(importPath: string, aliases: PathAlias[]): string | null {
  for (const alias of aliases) {
    if (importPath.startsWith(alias.prefix)) {
      const rest = importPath.slice(alias.prefix.length);
      // Return first target resolution
      return alias.targets[0] + rest;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// Import resolution helpers
// ─────────────────────────────────────────────────────────

function resolveRelativeImport(
  fromFile: string,
  importPath: string,
  allFiles: string[],
): string | undefined {
  const dir = fromFile.split('/').slice(0, -1).join('/');
  const joined = dir ? `${dir}/${importPath}` : importPath.replace(/^\.\//, '');
  // Normalize away ./ and ../ segments
  const parts = joined.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') { resolved.pop(); continue; }
    resolved.push(part);
  }
  const normalized = resolved.join('/');
  const base = normalized.replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/, '');

  return allFiles.find(f => {
    const fBase = f.replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/, '');
    return f === normalized || fBase === base ||
      f === `${base}.ts` || f === `${base}.tsx` ||
      f === `${base}.js` || f === `${base}.jsx` ||
      f === `${base}.mjs` || f === `${base}.cjs` ||
      f === `${normalized}/index.ts` || f === `${normalized}/index.tsx` ||
      f === `${normalized}/index.js` || f === `${normalized}/index.jsx`;
  });
}

function resolveAliasedImport(
  importPath: string,
  aliases: PathAlias[],
  allFiles: string[],
): string | undefined {
  const resolved = resolveAlias(importPath, aliases);
  if (!resolved) return undefined;

  const base = resolved.replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/, '');
  return allFiles.find(f => {
    const fBase = f.replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/, '');
    return f === resolved || fBase === base ||
      f === `${base}.ts` || f === `${base}.tsx` ||
      f === `${base}.js` || f === `${base}.jsx` ||
      f === `${base}.mjs` || f === `${base}.cjs` ||
      f === `${resolved}/index.ts` || f === `${resolved}/index.tsx` ||
      f === `${resolved}/index.js` || f === `${resolved}/index.jsx`;
  });
}

// ─────────────────────────────────────────────────────────
// Export extraction
// ─────────────────────────────────────────────────────────

function extractExportedNames(content: string): Set<string> {
  const exported = new Set<string>();

  // Named exports: export const/let/var/function/class/async function/type/interface/enum Name
  const namedExportRe = /export\s+(?:const|let|var|function|class|async\s+function|type|interface|enum)\s+(\w+)/g;
  let m;
  while ((m = namedExportRe.exec(content)) !== null) {
    exported.add(m[1]);
  }

  // Destructured exports: export const { a, b, c } = ...
  // Handles nested braces by depth-tracking
  const deStart = /export\s+(?:const|let|var)\s+\{/g;
  let ds;
  while ((ds = deStart.exec(content)) !== null) {
    let depth = 1;
    let j = ds.index + ds[0].length;
    while (j < content.length && depth > 0) {
      if (content[j] === '{') depth++;
      else if (content[j] === '}') depth--;
      j++;
    }
    const block = content.slice(ds.index + ds[0].length, j - 1);
    // Extract names from destructured block
    block.split(',').forEach(s => {
      const trimmed = s.trim();
      if (trimmed.includes(':')) {
        // Rename: { original: alias } — alias is the local name, original is what we export
        const parts = trimmed.split(':');
        const name = parts[0].trim().split(/[\s=]/)[0].trim();
        if (name && /^[a-zA-Z_$]\w*$/.test(name)) exported.add(name);
      } else {
        const name = trimmed.split(/[\s=]/)[0].trim();
        if (name && /^[a-zA-Z_$]\w*$/.test(name)) exported.add(name);
      }
    });
  }

  // Re-export blocks: export { X, Y, Z } or export { X as Z }
  const reExportRe = /export\s+\{([^}]+)\}/g;
  while ((m = reExportRe.exec(content)) !== null) {
    // Skip if this was already caught by the destructured export pattern
    const before = content.slice(Math.max(0, m.index - 20), m.index);
    if (/(?:const|let|var)\s*$/.test(before)) continue;

    m[1].split(',').forEach(s => {
      const trimmed = s.trim();
      // "X as Y" — export name is Y
      const asMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/);
      if (asMatch) {
        exported.add(asMatch[2]);
      } else {
        const name = trimmed.replace(/^type\s+/, '').trim();
        if (name && /^[a-zA-Z_$]\w*$/.test(name)) exported.add(name);
      }
    });
  }

  // export default function/class Name
  const defaultNamedRe = /export\s+default\s+(?:function|class)\s+(\w+)/g;
  while ((m = defaultNamedRe.exec(content)) !== null) {
    exported.add(m[1]);
    exported.add('default');
  }

  // export default expr — anonymous default
  if (/export\s+default\s+/.test(content)) {
    exported.add('default');
  }

  // Barrel re-export: export * from './module'
  // This is a wildcard — we can't know names statically, so mark it
  if (/export\s+\*\s+from/.test(content)) {
    exported.add('*');
  }

  return exported;
}

// ─────────────────────────────────────────────────────────
// Backend route collection
// ─────────────────────────────────────────────────────────

interface BackendRoute {
  method: string;
  path: string;
  file: string;
}

function collectBackendRoutes(ctx: AnalyzerContext): BackendRoute[] {
  const routes: BackendRoute[] = [];

  for (const [file, content] of ctx.fileContents) {
    // Only look at server-side files or Python/Go/Java files
    if (!serverFilter(file) && !/\.(py|rb|go|java|php)$/.test(file)) continue;

    // FastAPI / Flask: @router.get("/path") or @app.post("/path")
    const pyRouteRe = /@(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/gi;
    let m;
    while ((m = pyRouteRe.exec(content)) !== null) {
      routes.push({ method: m[1].toUpperCase(), path: m[2], file });
    }

    // Express / Hono / Fastify: router.get('/path', ...) or app.post('/path', ...)
    const jsRouteRe = /(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/gi;
    while ((m = jsRouteRe.exec(content)) !== null) {
      routes.push({ method: m[1].toUpperCase(), path: m[2], file });
    }

    // Next.js App Router: export function GET/POST in route.ts
    const nextAppRe = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
    while ((m = nextAppRe.exec(content)) !== null) {
      const routePath = file
        .replace(/\/route\.\w+$/, '')
        .replace(/^.*\/app\/api/, '/api')
        .replace(/^.*\/app/, '');
      routes.push({ method: m[1], path: routePath, file });
    }

    // Next.js Pages Router: pages/api/**.ts — supports all methods
    if (/pages\/api\//.test(file)) {
      const routePath = '/' + file
        .replace(/^.*pages\//, '')
        .replace(/\/index\.\w+$/, '')
        .replace(/\.\w+$/, '');
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        routes.push({ method, path: routePath, file });
      }
    }

    // Django: path('users/', views.user_list)
    const djangoRe = /path\s*\(\s*["']([^"']+)["']/g;
    while ((m = djangoRe.exec(content)) !== null) {
      const p = m[1].startsWith('/') ? m[1] : '/' + m[1];
      routes.push({ method: 'ANY', path: p, file });
    }
  }

  return routes;
}

function normalizeApiPath(url: string): string {
  return url
    .replace(/\?.*$/, '')          // strip query params
    .replace(/\/+$/, '')           // strip trailing slashes
    .replace(/\$\{[^}]+\}/g, '{id}')  // template literals
    .replace(/\{[^}]+\}/g, '{id}')    // path params
    .replace(/\/[a-f0-9-]{8,}/g, '/{id}')  // UUID-like segments
    .replace(/\/\d+/g, '/{id}');   // numeric IDs
}

function routeMatches(fetchPath: string, routePath: string): boolean {
  const a = normalizeApiPath(fetchPath);
  const b = normalizeApiPath(routePath);
  return a === b ||
    a.startsWith(b + '/') ||
    b.startsWith(a + '/') ||
    // Partial prefix match for parameterized routes
    a.replace(/\/\{id\}/g, '') === b.replace(/\/\{id\}/g, '');
}

// ─────────────────────────────────────────────────────────
// Main analyzer
// ─────────────────────────────────────────────────────────

export function analyzeCrossWiring(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();
  const aliases = loadPathAliases(ctx);

  // Build a file-set for fast existence checks
  const fileSet = new Set(ctx.files);

  // Pre-build export maps for all JS/TS source files (built lazily)
  const exportCache = new Map<string, Set<string>>();
  function getExports(filePath: string): Set<string> {
    let cached = exportCache.get(filePath);
    if (cached) return cached;
    const content = ctx.fileContents.get(filePath);
    if (!content) {
      cached = new Set<string>();
    } else {
      cached = extractExportedNames(content);
    }
    exportCache.set(filePath, cached);
    return cached;
  }

  // ────────────────────────────────────────────────────────
  // CHECK 1: Import Resolution (FK-CW-IMPORT-001)
  // Verify that relative and aliased imports point to real files
  // ────────────────────────────────────────────────────────

  for (const [file, content] of ctx.fileContents) {
    if (!jstsFilter(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comments
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;

      // Match: import ... from './path' or import ... from '../path'
      // Also catch: export ... from './path'
      // Also catch: require('./path')
      const importMatches = [
        ...line.matchAll(/(?:import|export)\s+.*?\s+from\s+['"](\.[^'"]+)['"]/g),
        ...line.matchAll(/require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g),
      ];

      for (const match of importMatches) {
        let importPath = match[1];
        // Strip .js/.ts extension that may be added for ESM compat
        // (file on disk might be .ts but import says .js)
        const resolved = resolveRelativeImport(file, importPath, ctx.files);
        if (!resolved) {
          // Try stripping .js -> .ts swap (common in ESM TypeScript)
          const swapped = importPath.replace(/\.js$/, '.ts').replace(/\.jsx$/, '.tsx');
          const resolvedSwapped = swapped !== importPath
            ? resolveRelativeImport(file, swapped, ctx.files)
            : undefined;

          if (!resolvedSwapped) {
            result.findings.push(makeFinding({
              ruleId: 'FK-CW-IMPORT-001',
              title: `Import references non-existent module "${importPath}"`,
              categoryId: 'FR',
              severity: 'high',
              confidence: 'high',
              labels: ['Broken', 'Fake Flow'],
              summary: `${file}:${i + 1} imports from "${importPath}" but no matching file exists on disk.`,
              impact: 'Build will fail or runtime import error. This module is a hallucination.',
              location: { file, startLine: i + 1 },
              codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 1, 1),
              suggestedFix: `Create the missing module or fix the import path.`,
            }));
            result.smellHits.push(makeSmell('SMELL-HALLUCINATED-REF', 'Hallucinated import target', 1));
          }
        }
      }

      // Check aliased imports (e.g. @/components/Button)
      const aliasImports = line.matchAll(/(?:import|export)\s+.*?\s+from\s+['"]([^.'"\/][^'"]*)['"]/g);
      for (const match of aliasImports) {
        const importPath = match[1];
        // Skip bare package imports (no alias prefix match)
        const aliasResolved = resolveAlias(importPath, aliases);
        if (!aliasResolved) continue; // It's a package import, not our concern

        const target = resolveAliasedImport(importPath, aliases, ctx.files);
        if (!target) {
          result.findings.push(makeFinding({
            ruleId: 'FK-CW-IMPORT-001',
            title: `Aliased import "${importPath}" resolves to non-existent file`,
            categoryId: 'FR',
            severity: 'high',
            confidence: 'high',
            labels: ['Broken', 'Fake Flow'],
            summary: `${file}:${i + 1} imports "${importPath}" (alias → "${aliasResolved}") but no matching file exists.`,
            impact: 'Build will fail. The aliased path points nowhere.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 1, 1),
            suggestedFix: `Create the file at "${aliasResolved}" or fix the import path.`,
          }));
          result.smellHits.push(makeSmell('SMELL-HALLUCINATED-REF', 'Hallucinated aliased import', 1));
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────
  // CHECK 2: Route-Handler Mapping (FK-CW-ROUTE-001)
  // Verify frontend API calls have matching backend handlers
  // ────────────────────────────────────────────────────────

  const backendRoutes = collectBackendRoutes(ctx);

  // Only run this check if we actually found backend routes
  // (otherwise the existing wiring.ts check 5 handles the no-backend case)
  if (backendRoutes.length > 0) {
    const apiCallPatterns = [
      // fetch('/api/...') or fetch(`/api/...`)
      /fetch\s*\(\s*[`'"](\/[^`'"]+)[`'"]/,
      // axios.get('/api/...'), axios.post(...)
      /axios\.(get|post|put|patch|delete)\s*\(\s*[`'"](\/[^`'"]+)[`'"]/,
      // api.get('/...'), client.post('/...')
      /(?:api|client|http|request)\.(get|post|put|patch|delete)\s*\(\s*[`'"](\/[^`'"]+)[`'"]/,
      // useFetch('/api/...'), useSWR('/api/...'), useQuery('/api/...')
      /(?:useFetch|useSWR|useQuery)\s*\(\s*[`'"](\/[^`'"]+)[`'"]/,
    ];

    // Track which endpoints we've already reported to avoid duplicates with wiring.ts
    const reportedEndpoints = new Set<string>();

    for (const [file, content] of ctx.fileContents) {
      if (!jstsFilter(file)) continue;
      // Skip server-side files — they're not "frontend calling backend"
      if (serverFilter(file)) continue;
      if (isTestFile(file)) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;

        for (const pattern of apiCallPatterns) {
          const match = line.match(pattern);
          if (!match) continue;

          const fetchUrl = match[2] || match[1];
          if (!fetchUrl || /^https?:\/\//.test(fetchUrl)) continue;

          const normalized = normalizeApiPath(fetchUrl);
          const dedupeKey = `${file}:${normalized}`;
          if (reportedEndpoints.has(dedupeKey)) continue;

          const hasMatch = backendRoutes.some(route => routeMatches(fetchUrl, route.path));

          if (!hasMatch) {
            reportedEndpoints.add(dedupeKey);
            result.findings.push(makeFinding({
              ruleId: 'FK-CW-ROUTE-001',
              title: `Frontend calls "${normalized}" — no backend handler found`,
              categoryId: 'BE',
              severity: 'high',
              confidence: 'medium',
              labels: ['Broken', 'Fake Flow'],
              summary: `${file}:${i + 1} calls "${fetchUrl}" but no matching route handler exists in backend files.`,
              impact: 'This API call will 404 at runtime. The integration is fake.',
              location: { file, startLine: i + 1 },
              codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 1, 2),
              evidenceRefs: [
                `Known backend routes: ${backendRoutes.length}`,
                ...backendRoutes.slice(0, 5).map(r => `${r.method} ${r.path} (${r.file})`),
              ],
              suggestedFix: `Create a backend handler for "${normalized}" or fix the frontend URL.`,
            }));
            result.smellHits.push(makeSmell('SMELL-FAKE-INTEGRATION-ADAPTER', 'Fake API integration', 1));
          }
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────
  // CHECK 3: Event Handler Verification (FK-CW-HANDLER-001)
  // Verify JSX event handler references resolve to real functions
  // ────────────────────────────────────────────────────────

  for (const [file, content] of ctx.fileContents) {
    if (!uiFilter(file)) continue;
    const lines = content.split('\n');

    // Collect all symbols defined or imported in this file
    const definedSymbols = new Set<string>();

    // 1. Extract all { destructured } names (props, imports, destructuring)
    const braceBlocks = content.matchAll(/\{\s*([^{}]+?)\s*\}/g);
    for (const block of braceBlocks) {
      const inner = block[1];
      inner.split(',').forEach(s => {
        const trimmed = s.trim();
        if (trimmed.includes(':')) {
          const parts = trimmed.split(':');
          const original = parts[0].trim().split(/[\s=]/)[0].trim();
          const alias = parts[1].trim().split(/[\s=]/)[0].trim();
          if (original && /^[a-zA-Z_$]\w*$/.test(original)) definedSymbols.add(original);
          if (alias && /^[a-zA-Z_$]\w*$/.test(alias)) definedSymbols.add(alias);
        } else {
          const name = trimmed.split(/[\s=]/)[0].trim();
          if (name && /^[a-zA-Z_$]\w*$/.test(name)) definedSymbols.add(name);
        }
      });
    }

    // 2. Function/const/let/var declarations and imports
    for (const line of lines) {
      const funcMatch = line.match(/(?:function|const|let|var)\s+(\w+)/);
      if (funcMatch) definedSymbols.add(funcMatch[1]);

      const defaultImport = line.match(/import\s+(\w+)\s+from/);
      if (defaultImport) definedSymbols.add(defaultImport[1]);

      const importMatch = line.match(/import\s+\{([^}]+)\}/);
      if (importMatch) {
        importMatch[1].split(',').forEach(s => {
          const name = s.trim().split(/\s+as\s+/).pop()?.trim();
          if (name) definedSymbols.add(name);
        });
      }

      // Class methods
      const methodMatch = line.match(/^\s+(\w+)\s*\(/);
      if (methodMatch) definedSymbols.add(methodMatch[1]);

      // Object methods: { handleClick() { ... } } or handleClick: () => { ... }
      const objMethod = line.match(/(\w+)\s*(?::\s*(?:async\s+)?(?:\([^)]*\)|)\s*=>|\s*\([^)]*\)\s*\{)/);
      if (objMethod) definedSymbols.add(objMethod[1]);
    }

    // 3. Check event handler references in JSX
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match onClick={handleX}, onSubmit={submitForm}, onChange={updateValue} etc.
      // But NOT inline arrows: onClick={() => ...} or onClick={(e) => ...}
      // And NOT method calls: onClick={this.handleX} or onClick={obj.method}
      const handlerRefs = line.matchAll(
        /on(?:Click|Submit|Change|Press|Blur|Focus|KeyDown|KeyUp|KeyPress|MouseDown|MouseUp|MouseEnter|MouseLeave|TouchStart|TouchEnd|Scroll|Drag|Drop|Input|Select|Copy|Paste|Cut|DoubleClick|ContextMenu|Load|Error)\s*=\s*\{(\w+)\}/gi
      );

      for (const match of handlerRefs) {
        const handlerName = match[1];
        // Skip common non-handler values
        if (/^(undefined|null|true|false|console|window|document|Math|JSON|Object|Array|String|Number|Boolean|Date|Error|Promise|RegExp|Map|Set)$/.test(handlerName)) continue;

        if (!definedSymbols.has(handlerName)) {
          // Double-check: search the full content for the name defined anywhere
          // This catches patterns we might miss in single-line scanning
          const fullDefCheck = new RegExp(
            `(?:function|const|let|var|async\\s+function)\\s+${handlerName}\\b|` +
            `\\b${handlerName}\\s*(?:=|:)\\s*(?:async\\s+)?(?:\\(|function)`
          );
          if (fullDefCheck.test(content)) continue;

          result.findings.push(makeFinding({
            ruleId: 'FK-CW-HANDLER-001',
            title: `Event handler "${handlerName}" references undefined function`,
            categoryId: 'FW',
            severity: 'critical',
            confidence: 'high',
            labels: ['Broken', 'Dead Control'],
            summary: `${file}:${i + 1} references handler "${handlerName}" which is not defined, imported, or passed as a prop in this file.`,
            impact: 'Clicking this control throws ReferenceError at runtime. The feature is broken.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 2, 2),
            suggestedFix: `Define "${handlerName}" as a function, import it, or pass it as a prop.`,
          }));
          result.smellHits.push(makeSmell('SMELL-HALLUCINATED-REF', 'Hallucinated event handler', 1));
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────
  // CHECK 4: Export/Import Name Matching (FK-CW-EXPORT-001)
  // Verify named imports actually exist in the target module
  // ────────────────────────────────────────────────────────

  for (const [file, content] of ctx.fileContents) {
    if (!jstsFilter(file)) continue;

    // Match named imports: import { X, Y } from './module'
    // Handles multi-line via the regex running on full content
    const namedImportRe = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
    let nim;
    while ((nim = namedImportRe.exec(content)) !== null) {
      const importedNames = nim[1]
        .split(',')
        .map(s => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
        .filter(s => s && s !== 'type' && /^[a-zA-Z_$]\w*$/.test(s));
      const importPath = nim[2];

      // Skip package imports — we can't verify them without node_modules
      const isRelative = importPath.startsWith('.');
      const isAliased = aliases.some(a => importPath.startsWith(a.prefix));
      if (!isRelative && !isAliased) continue;

      // Find the line number of this import
      const beforeImport = content.slice(0, nim.index);
      const lineNum = beforeImport.split('\n').length;

      // Resolve to target file
      let targetFile: string | undefined;
      if (isRelative) {
        targetFile = resolveRelativeImport(file, importPath, ctx.files);
      } else if (isAliased) {
        targetFile = resolveAliasedImport(importPath, aliases, ctx.files);
      }

      if (!targetFile) continue; // Already flagged by Check 1

      const targetExports = getExports(targetFile);

      // If target has `export *`, we can't verify — skip
      if (targetExports.has('*')) continue;

      for (const name of importedNames) {
        if (!targetExports.has(name)) {
          result.findings.push(makeFinding({
            ruleId: 'FK-CW-EXPORT-001',
            title: `"${name}" imported from "${importPath}" but not exported there`,
            categoryId: 'FR',
            severity: 'high',
            confidence: 'high',
            labels: ['Broken', 'Fake Flow'],
            summary: `${file}:${lineNum} imports { ${name} } from "${importPath}" but the target file doesn't export it.`,
            impact: 'Import will fail at build or runtime. This is a hallucinated export name.',
            location: { file, startLine: lineNum },
            codeSnippet: extractSnippet(ctx.fileContents, file, lineNum, 1, 1),
            evidenceRefs: [
              `Target file: ${targetFile}`,
              `Exports found: ${Array.from(targetExports).slice(0, 10).join(', ')}${targetExports.size > 10 ? '...' : ''}`,
            ],
            suggestedFix: `Export "${name}" from "${importPath}" or fix the import to use a name that exists.`,
          }));
          result.smellHits.push(makeSmell('SMELL-HALLUCINATED-REF', 'Hallucinated named export', 1));
        }
      }
    }
  }

  return result;
}
