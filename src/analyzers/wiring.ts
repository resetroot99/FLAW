// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
// FLAW — Cross-boundary wiring verification
// Catches the #1 AI-generated failure: code that looks connected but isn't

import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, makeSmell, emptyResult } from './base.js';
import { searchFiles, filesMatching, extractSnippet } from '../utils/patterns.js';
import { isTestFile, isSourceFile } from '../utils/fs.js';

const uiFilter = (f: string) => /\.(tsx|jsx|vue|svelte)$/.test(f) && !isTestFile(f);
const srcFilter = (f: string) => isSourceFile(f) && !isTestFile(f);
const serverFilter = (f: string) => srcFilter(f) && /\b(api|server|route|action|controller|handler|middleware|mutation|views|endpoints)\b/i.test(f);

export function analyzeWiring(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  // ── 1. onClick/onSubmit calls a function that doesn't exist in scope ──
  // Find handler references like onClick={handleSave} and verify handleSave is defined
  for (const [file, content] of ctx.fileContents) {
    if (!uiFilter(file)) continue;
    const lines = content.split('\n');

    // Collect all defined functions/consts in this file
    const definedSymbols = new Set<string>();

    // First pass: collect all { destructured } blocks across all contexts
    // This catches props, object destructuring, imports — including multiline
    const fullContent = content;

    // Extract all destructured names from { ... } patterns (props, imports, destructuring)
    const braceBlocks = fullContent.matchAll(/\{\s*([^{}]+?)\s*\}/g);
    for (const block of braceBlocks) {
      const inner = block[1];
      // Split by comma and extract identifier names
      inner.split(',').forEach(s => {
        const trimmed = s.trim();
        // Handle rename patterns like "icon: IconComponent" — both names are in scope
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

    for (const line of lines) {
      // function/const/let/var declarations
      const funcMatch = line.match(/(?:function|const|let|var)\s+(\w+)/);
      if (funcMatch) definedSymbols.add(funcMatch[1]);
      // Default imports
      const defaultImport = line.match(/import\s+(\w+)\s+from/);
      if (defaultImport) definedSymbols.add(defaultImport[1]);
      // Named imports
      const importMatch = line.match(/import\s+\{([^}]+)\}/);
      if (importMatch) {
        importMatch[1].split(',').forEach(s => {
          const name = s.trim().split(/\s+as\s+/).pop()?.trim();
          if (name) definedSymbols.add(name);
        });
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match onClick={handleX} or onSubmit={submitForm} etc (not inline arrows)
      const handlerRefs = line.matchAll(/on(?:Click|Submit|Change|Press|Blur|Focus|KeyDown|KeyUp)\s*=\s*\{(\w+)\}/gi);
      for (const match of handlerRefs) {
        const handlerName = match[1];
        if (!definedSymbols.has(handlerName) && handlerName !== 'undefined') {
          result.findings.push(makeFinding({
            ruleId: 'FK-FW-WIRE-001',
            title: `Handler "${handlerName}" referenced but not defined`,
            categoryId: 'FW',
            severity: 'critical',
            confidence: 'high',
            labels: ['Broken', 'Dead Control'],
            summary: `${file}:${i + 1} references handler "${handlerName}" which is not defined or imported in this file.`,
            impact: 'Clicking this control will throw a ReferenceError at runtime.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 2, 2),
            suggestedFix: `Define "${handlerName}" or import it from the correct module.`,
          }));
        }
      }
    }
  }

  // ── 2. Component renders a component that doesn't exist ──
  for (const [file, content] of ctx.fileContents) {
    if (!uiFilter(file)) continue;
    const lines = content.split('\n');

    // Collect imports (handles multi-line imports)
    const importedComponents = new Set<string>();
    const localComponents = new Set<string>();

    // Extract all import names — first with multi-line regex on full content
    const multiImportRe = /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))(?:\s*,\s*\{([^}]+)\})?\s+from/g;
    let im;
    while ((im = multiImportRe.exec(content)) !== null) {
      for (const group of [im[1], im[3]]) {
        if (group) {
          group.split(',').forEach(s => {
            const name = s.trim().split(/\s+as\s+/).pop()?.trim();
            if (name && name !== 'type') importedComponents.add(name);
          });
        }
      }
      if (im[2]) importedComponents.add(im[2]);
    }

    for (const line of lines) {
      // Local component definitions
      const compDef = line.match(/(?:function|const)\s+([A-Z]\w+)/);
      if (compDef) localComponents.add(compDef[1]);
      // Type/interface declarations (so we don't flag generics as components)
      const typeDef = line.match(/(?:type|interface|enum)\s+([A-Z]\w+)/);
      if (typeDef) localComponents.add(typeDef[1]);
    }

    // Also detect prop rename aliases: { icon: IconComponent } means IconComponent is in scope
    const renamePattern = /\w+\s*:\s*([A-Z]\w+)/g;
    let renameMatch;
    while ((renameMatch = renamePattern.exec(content)) !== null) {
      localComponents.add(renameMatch[1]);
    }

    // Find JSX component usage: <ComponentName — but NOT TypeScript generics
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const jsxUsages = line.matchAll(/<([A-Z]\w+)(?:\s|\/|>)/g);
      for (const match of jsxUsages) {
        const compName = match[1];
        // Skip common React built-ins
        if (/^(React|Fragment|Suspense|StrictMode|Provider|Consumer|ErrorBoundary)$/.test(compName)) continue;
        // Skip TypeScript generics: useRef<HTMLDivElement>, useState<Type>, Promise<Type>, etc.
        // Detected by being preceded by a word character or generic-context keywords
        const charBefore = line[match.index! - 1] || '';
        if (/\w/.test(charBefore)) continue; // e.g., useRef<HTMLDivElement> — '<' preceded by 'f'
        // Skip well-known TS/DOM types used as generics
        if (/^(HTML\w+Element|SVG\w+Element|Event|Mouse|Keyboard|Focus|Touch|Pointer|Wheel|Animation|Transition|Clipboard|Drag|Form|Input|Change|Submit|Abort|Error|Promise|Array|Map|Set|Record|Partial|Required|Pick|Omit|Exclude|Extract|ReturnType|Parameters|InstanceType|Awaited)/.test(compName)) continue;
        // Skip type annotations: `: Type` or `as Type` or `extends Type`
        const contextBefore = line.slice(Math.max(0, match.index! - 15), match.index!);
        if (/(?::\s*|as\s+|extends\s+|implements\s+|typeof\s+)$/.test(contextBefore)) continue;
        if (!importedComponents.has(compName) && !localComponents.has(compName)) {
          result.findings.push(makeFinding({
            ruleId: 'FK-FW-WIRE-002',
            title: `Component <${compName}> used but not imported`,
            categoryId: 'FW',
            severity: 'critical',
            confidence: 'high',
            labels: ['Broken', 'Fake Flow'],
            summary: `${file}:${i + 1} renders <${compName}> which is not imported or defined locally.`,
            impact: 'This component will fail to render at runtime.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1),
            suggestedFix: `Import ${compName} from the correct module.`,
          }));
        }
      }
    }
  }

  // ── 3. Unhandled async — calling async function without await ──
  for (const [file, content] of ctx.fileContents) {
    if (!srcFilter(file)) continue;
    const lines = content.split('\n');

    // Build set of async functions defined in this file
    const asyncFunctions = new Set<string>();
    for (const line of lines) {
      const asyncDef = line.match(/async\s+(?:function\s+)?(\w+)/);
      if (asyncDef) asyncFunctions.add(asyncDef[1]);
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip lines that already have await, or are definitions
      if (/\bawait\b/.test(line) || /async\s+(function\s+)?/.test(line)) continue;
      // Skip comments
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;

      for (const funcName of asyncFunctions) {
        // Check for direct calls without await: funcName(...) not preceded by await or return
        const callRegex = new RegExp(`(?<!await\\s)(?<!return\\s)(?<!\\.\\s*)\\b${funcName}\\s*\\(`, 'g');
        if (callRegex.test(line)) {
          // Verify it's not in a .then() chain, Promise.all, or assignment to a variable that gets awaited
          const region = lines.slice(i, Math.min(i + 3, lines.length)).join('\n');
          if (!/\.then\s*\(|\.catch\s*\(|Promise\.(all|race|allSettled)|await/.test(region)) {
            result.findings.push(makeFinding({
              ruleId: 'FK-FW-ASYNC-001',
              title: `Async function "${funcName}" called without await`,
              categoryId: 'FR',
              severity: 'high',
              confidence: 'medium',
              labels: ['Fragile', 'Silent Failure'],
              summary: `${file}:${i + 1} calls async "${funcName}()" without await — errors will be silently swallowed.`,
              impact: 'Unhandled promise: errors vanish, race conditions, state inconsistency.',
              location: { file, startLine: i + 1 },
              codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 1, 2),
              suggestedFix: `Add "await" before ${funcName}() or handle the returned promise.`,
            }));
            result.smellHits.push(makeSmell('SMELL-UNHANDLED-PROMISE', 'Unhandled async call', 1));
          }
        }
      }
    }
  }

  // ── 4. useState declared but never used in JSX ──
  for (const [file, content] of ctx.fileContents) {
    if (!uiFilter(file)) continue;
    const lines = content.split('\n');

    // Find all useState declarations
    const stateVars: { name: string; setter: string; line: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const stateMatch = lines[i].match(/const\s+\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*useState/);
      if (stateMatch) {
        stateVars.push({ name: stateMatch[1], setter: stateMatch[2], line: i + 1 });
      }
    }

    for (const sv of stateVars) {
      // Check if state var is referenced anywhere AFTER its declaration (in JSX or logic)
      const afterDeclaration = lines.slice(sv.line).join('\n');
      const nameUsed = new RegExp(`\\b${sv.name}\\b`).test(afterDeclaration);
      const setterUsed = new RegExp(`\\b${sv.setter}\\b`).test(afterDeclaration);

      if (!nameUsed && !setterUsed) {
        result.findings.push(makeFinding({
          ruleId: 'FK-FW-STATE-002',
          title: `State "${sv.name}" declared but never used`,
          categoryId: 'FW',
          severity: 'medium',
          confidence: 'high',
          labels: ['Dead Control', 'Incomplete'],
          summary: `${file}:${sv.line} declares useState("${sv.name}") but neither the value nor setter is used.`,
          impact: 'Dead state indicates unfinished feature or leftover from refactoring.',
          location: { file, startLine: sv.line },
          codeSnippet: extractSnippet(ctx.fileContents, file, sv.line),
          suggestedFix: `Remove unused state or implement the feature that uses "${sv.name}".`,
        }));
      } else if (setterUsed && !nameUsed) {
        result.findings.push(makeFinding({
          ruleId: 'FK-FW-STATE-002',
          title: `State "${sv.name}" is set but never read`,
          categoryId: 'FW',
          severity: 'high',
          confidence: 'high',
          labels: ['Dead Control', 'Incomplete'],
          summary: `${file}:${sv.line} calls ${sv.setter}() but "${sv.name}" is never rendered or checked.`,
          impact: 'State is updated for nothing — the UI never reflects it.',
          location: { file, startLine: sv.line },
          codeSnippet: extractSnippet(ctx.fileContents, file, sv.line),
          suggestedFix: `Use "${sv.name}" in the component's render output or remove the state.`,
        }));
      }
    }
  }

  // ── 5. API fetch URL → backend route cross-check (enhanced) ──
  // Collect all backend routes with their methods
  const backendRoutes: { method: string; path: string; file: string }[] = [];
  for (const [file, content] of ctx.fileContents) {
    if (!serverFilter(file) && !/\.(py|rb|go|java|php)$/.test(file)) continue;

    // FastAPI / Flask: @router.get("/path") or @app.post("/path")
    const pyRouteRegex = /@(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/gi;
    let match;
    while ((match = pyRouteRegex.exec(content)) !== null) {
      backendRoutes.push({ method: match[1].toUpperCase(), path: match[2], file });
    }

    // Express: router.get('/path', ...) or app.post('/path', ...)
    const jsRouteRegex = /(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/gi;
    while ((match = jsRouteRegex.exec(content)) !== null) {
      backendRoutes.push({ method: match[1].toUpperCase(), path: match[2], file });
    }

    // Next.js App Router: export function GET/POST/etc
    const nextRouteRegex = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
    while ((match = nextRouteRegex.exec(content)) !== null) {
      // Derive path from file path
      const routePath = file.replace(/\/route\.\w+$/, '').replace(/^.*\/app\/api/, '/api');
      backendRoutes.push({ method: match[1], path: routePath, file });
    }
  }

  // Find all frontend API calls
  const apiCallPatterns = [
    /fetch\s*\(\s*[`'"](\/[^`'"]+)[`'"]/,
    /axios\.(get|post|put|patch|delete)\s*\(\s*[`'"](\/[^`'"]+)[`'"]/,
    /\.\s*(get|post|put|patch|delete)\s*\(\s*[`'"](\/[^`'"]+)[`'"]/,
  ];

  for (const [file, content] of ctx.fileContents) {
    if (isTestFile(file) || !/\.(tsx?|jsx?)$/.test(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of apiCallPatterns) {
        const match = line.match(pattern);
        if (!match) continue;

        const fetchUrl = match[2] || match[1];
        // Skip external URLs
        if (/^https?:\/\//.test(fetchUrl)) continue;
        // Normalize: remove query params, trailing slashes, template vars
        const normalizedUrl = fetchUrl.replace(/\?.*$/, '').replace(/\/+$/, '').replace(/\$\{[^}]+\}/g, '{id}');

        // Check if any backend route could match
        if (backendRoutes.length > 0) {
          const routeMatches = backendRoutes.some(route => {
            const normalizedRoute = route.path.replace(/\{[^}]+\}/g, '{id}').replace(/\/+$/, '');
            return normalizedUrl === normalizedRoute ||
              normalizedUrl.startsWith(normalizedRoute) ||
              normalizedRoute.startsWith(normalizedUrl) ||
              // Handle path param variants: /api/users/123 matches /api/users/{id}
              normalizedUrl.replace(/\/[a-f0-9-]{8,}|\/\d+/g, '/{id}') === normalizedRoute.replace(/\/[a-f0-9-]{8,}|\/\d+/g, '/{id}');
          });

          if (!routeMatches) {
            result.findings.push(makeFinding({
              ruleId: 'FK-BE-WIRE-001',
              title: `Frontend fetches "${normalizedUrl}" — no matching backend route`,
              categoryId: 'BE',
              severity: 'high',
              confidence: 'medium',
              labels: ['Broken', 'Fake Flow'],
              summary: `${file}:${i + 1} calls "${normalizedUrl}" but no backend handler was found for this path.`,
              impact: 'This API call will return 404 at runtime.',
              location: { file, startLine: i + 1 },
              codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 1, 2),
              suggestedFix: 'Create the backend route or fix the URL.',
            }));
            result.smellHits.push(makeSmell('SMELL-DISCONNECTED-FRONTEND', 'Disconnected frontend call', 1));
          }
        }
      }
    }
  }

  // ── 5b. API client class methods — this.request('/path') pattern ──
  for (const [file, content] of ctx.fileContents) {
    if (isTestFile(file) || !/\.(tsx?|jsx?)$/.test(file)) continue;
    if (!/class\s+\w*(?:Api|Client|Service)\b|(?:request|fetch|get|post)\s*[<(]/i.test(content)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match: this.request<Type>('/api/v1/foo') or return this.get('/path')
      const clientMatch = line.match(/this\.(?:request|get|post|put|patch|delete)\s*(?:<[^>]+>)?\s*\(\s*[`'"](\/[^`'"]+)[`'"]/);
      if (!clientMatch) continue;

      const fetchUrl = clientMatch[1].replace(/\?.*$/, '').replace(/\/+$/, '').replace(/\$\{[^}]+\}/g, '{id}');
      if (/^https?:\/\//.test(fetchUrl)) continue;

      if (backendRoutes.length > 0) {
        const routeMatches = backendRoutes.some(route => {
          const normalizedRoute = route.path.replace(/\{[^}]+\}/g, '{id}').replace(/\/+$/, '');
          return fetchUrl === normalizedRoute ||
            fetchUrl.startsWith(normalizedRoute) ||
            normalizedRoute.startsWith(fetchUrl) ||
            fetchUrl.replace(/\/[a-f0-9-]{8,}|\/\d+/g, '/{id}') === normalizedRoute.replace(/\/[a-f0-9-]{8,}|\/\d+/g, '/{id}');
        });

        if (!routeMatches) {
          result.findings.push(makeFinding({
            ruleId: 'FK-BE-WIRE-001',
            title: `API client method calls "${fetchUrl}" — no matching backend route`,
            categoryId: 'BE',
            severity: 'high',
            confidence: 'medium',
            labels: ['Broken', 'Fake Flow'],
            summary: `${file}:${i + 1} defines an API call to "${fetchUrl}" but no backend handler was found.`,
            impact: 'This API call will return 404 at runtime.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 1, 2),
            suggestedFix: 'Create the backend route or remove the dead API method.',
          }));
          result.smellHits.push(makeSmell('SMELL-DISCONNECTED-FRONTEND', 'Disconnected frontend call', 1));
        }
      }
    }
  }

  // ── 6. Imported module doesn't export what's being imported ──
  for (const [file, content] of ctx.fileContents) {
    if (!srcFilter(file) || !/\.(tsx?|jsx?)$/.test(file)) continue;

    // Match named imports including multi-line: import { X, Y } from './module'
    const namedImportRe = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"]/g;
    let nim;
    while ((nim = namedImportRe.exec(content)) !== null) {
      const importedNames = nim[1].split(',')
        .map(s => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
        .filter(s => s && s !== 'type');
      const importPath = nim[2];

      // Find the line number for the import
      const importIdx = content.lastIndexOf(nim[0], nim.index + nim[0].length);
      const i = content.slice(0, importIdx >= 0 ? importIdx : nim.index).split('\n').length - 1;

      // Resolve the import path
      const dir = file.split('/').slice(0, -1).join('/');
      const resolved = dir ? `${dir}/${importPath}`.replace(/\/\.\//g, '/') : importPath.replace(/^\.\//, '');
      const normalized = resolved.replace(/\/+/g, '/');
      const base = normalized.replace(/\.(js|jsx|ts|tsx)$/, '');

      // Find the target file
      const targetFile = ctx.files.find(f => {
        const fBase = f.replace(/\.(js|jsx|ts|tsx)$/, '');
        return f === normalized || fBase === base || f === `${base}.ts` || f === `${base}.tsx` ||
          f === `${base}.js` || f === `${base}.jsx` || f === `${normalized}/index.ts` || f === `${normalized}/index.tsx`;
      });

      if (!targetFile) continue; // Already caught by hallucinated-ref smell
      const targetContent = ctx.fileContents.get(targetFile);
      if (!targetContent) continue;

      for (const name of importedNames) {
        // Check if the target file exports this name
        const exportPatterns = [
          new RegExp(`export\\s+(?:const|let|var|function|class|async\\s+function|type|interface|enum)\\s+${name}\\b`),
          new RegExp(`export\\s+\\{[^}]*\\b${name}\\b[^}]*\\}`),
          new RegExp(`export\\s+default\\s+${name}\\b`),
          new RegExp(`export\\s+\\*`), // re-export all
        ];
        // Also check destructured exports: export const { ..., name, ... } = ... (handles nested braces)
        let isDestructuredExport = false;
        const deStart = /export\s+(?:const|let|var)\s+\{/g;
        let ds;
        while ((ds = deStart.exec(targetContent)) !== null) {
          // Walk forward from the opening brace to find the matching closing brace
          let depth = 1;
          let j = ds.index + ds[0].length;
          while (j < targetContent.length && depth > 0) {
            if (targetContent[j] === '{') depth++;
            else if (targetContent[j] === '}') depth--;
            j++;
          }
          const block = targetContent.slice(ds.index, j);
          if (new RegExp(`\\b${name}\\b`).test(block)) { isDestructuredExport = true; break; }
        }
        const isExported = exportPatterns.some(p => p.test(targetContent)) || isDestructuredExport;

        if (!isExported) {
          result.findings.push(makeFinding({
            ruleId: 'FK-FW-WIRE-003',
            title: `"${name}" imported from "${importPath}" but not exported there`,
            categoryId: 'FR',
            severity: 'critical',
            confidence: 'high',
            labels: ['Broken', 'Fake Flow'],
            summary: `${file}:${i + 1} imports "${name}" from "${importPath}" but that module doesn't export it.`,
            impact: 'Import will fail at runtime or build time.',
            location: { file, startLine: i + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1),
            suggestedFix: `Verify "${name}" is exported from "${importPath}" or fix the import.`,
          }));
          result.smellHits.push(makeSmell('SMELL-BROKEN-IMPORT', 'Broken import', 1));
        }
      }
    }
  }

  // ── 7. useEffect with missing cleanup for subscriptions/intervals ──
  for (const [file, content] of ctx.fileContents) {
    if (!uiFilter(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/useEffect\s*\(/.test(line)) continue;

      // Grab the effect body (up to 30 lines)
      const effectBody = lines.slice(i, Math.min(i + 30, lines.length)).join('\n');

      // Check for subscriptions/intervals/listeners that need cleanup
      const needsCleanup = /(setInterval|addEventListener|subscribe|on\(\s*['"]|\.observe\(|new\s+(WebSocket|EventSource|MutationObserver))/i.test(effectBody);
      const hasCleanup = /return\s*\(\s*\)\s*=>|return\s+(?:function|\(\))/i.test(effectBody);

      if (needsCleanup && !hasCleanup) {
        result.findings.push(makeFinding({
          ruleId: 'FK-FW-EFFECT-001',
          title: 'useEffect creates subscription without cleanup',
          categoryId: 'FW',
          severity: 'high',
          confidence: 'medium',
          labels: ['Fragile', 'Silent Failure'],
          summary: `${file}:${i + 1} sets up a subscription/interval/listener but has no cleanup return.`,
          impact: 'Memory leaks, stale listeners, duplicate event handlers on re-render.',
          location: { file, startLine: i + 1 },
          codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 0, 6),
          suggestedFix: 'Return a cleanup function from useEffect that removes the subscription.',
        }));
      }
    }
  }

  // ── 8. Environment variables referenced but not defined anywhere ──
  const envVarsUsed = new Map<string, { file: string; line: number }[]>();
  const envPatterns = [
    /process\.env\.(\w+)/g,
    /import\.meta\.env\.(\w+)/g,
  ];

  for (const [file, content] of ctx.fileContents) {
    if (!srcFilter(file)) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of envPatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(lines[i])) !== null) {
          const varName = match[1];
          if (/^(NODE_ENV|PORT|HOST|PWD|HOME|PATH|CI|DEBUG|TZ|ENVIRONMENT|ENV|LOG_LEVEL|LANG|USER|SHELL|TERM|HOSTNAME)$/.test(varName)) continue;
          const refs = envVarsUsed.get(varName) || [];
          refs.push({ file, line: i + 1 });
          envVarsUsed.set(varName, refs);
        }
      }
    }
  }

  // Check .env files for definitions
  const envDefinitions = new Set<string>();
  for (const [file, content] of ctx.fileContents) {
    if (!/\.env/.test(file)) continue;
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
      if (match) envDefinitions.add(match[1]);
    }
  }

  // Python: os.environ / os.getenv patterns
  const pyEnvHits = searchFiles(ctx.fileContents, /os\.(?:environ(?:\.get)?\s*\[\s*["'](\w+)["']\]|getenv\s*\(\s*["'](\w+)["']\))/i, srcFilter);
  for (const hit of pyEnvHits) {
    const varMatch = hit.match.match(/["'](\w+)["']/);
    if (varMatch) {
      const varName = varMatch[1];
      if (!/^(NODE_ENV|PORT|HOST|PWD|HOME|PATH|CI|DEBUG|TZ|ENVIRONMENT|ENV|LOG_LEVEL|LANG|USER|SHELL|TERM|HOSTNAME)$/.test(varName)) {
        const refs = envVarsUsed.get(varName) || [];
        refs.push({ file: hit.file, line: hit.line });
        envVarsUsed.set(varName, refs);
      }
    }
  }

  if (envVarsUsed.size > 0 && envDefinitions.size > 0) {
    const undefinedVars: string[] = [];
    for (const [varName] of envVarsUsed) {
      if (!envDefinitions.has(varName)) {
        undefinedVars.push(varName);
      }
    }

    if (undefinedVars.length > 3) {
      const topRefs = undefinedVars.slice(0, 8);
      const firstRef = envVarsUsed.get(undefinedVars[0])![0];
      result.findings.push(makeFinding({
        ruleId: 'FK-DO-ENV-002',
        title: `${undefinedVars.length} env vars referenced but not defined in any .env file`,
        categoryId: 'DO',
        severity: 'medium',
        confidence: 'medium',
        labels: ['Incomplete', 'Fragile'],
        summary: `Code references ${undefinedVars.length} environment variables not found in .env files.`,
        impact: 'App may crash or behave unexpectedly in new environments.',
        location: { file: firstRef.file, startLine: firstRef.line },
        codeSnippet: extractSnippet(ctx.fileContents, firstRef.file, firstRef.line),
        evidenceRefs: topRefs.map(v => {
          const ref = envVarsUsed.get(v)![0];
          return `${v} — ${ref.file}:${ref.line}`;
        }),
        suggestedFix: 'Add missing env vars to .env.example with descriptions.',
      }));
    }
  }

  // ── 9. Frontend type fields vs backend response model fields ──
  // Detect when frontend expects fields the backend doesn't return
  // Collect TypeScript interfaces from frontend
  const tsInterfaces = new Map<string, { fields: string[]; file: string; line: number }>();
  for (const [file, content] of ctx.fileContents) {
    if (!/\.(ts|tsx)$/.test(file) || isTestFile(file)) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ifaceMatch = lines[i].match(/(?:export\s+)?interface\s+(\w+(?:Out|Response|Result|Data|Payload))\s*(?:extends\s+\w+\s*)?\{/);
      if (!ifaceMatch) continue;
      const name = ifaceMatch[1];
      const fields: string[] = [];
      for (let j = i + 1; j < Math.min(i + 50, lines.length); j++) {
        if (/^\s*\}/.test(lines[j])) break;
        const fieldMatch = lines[j].match(/^\s*(\w+)\s*[?:]?\s*:/);
        if (fieldMatch) fields.push(fieldMatch[1]);
      }
      if (fields.length > 0) {
        tsInterfaces.set(name, { fields, file, line: i + 1 });
      }
    }
  }

  // Collect Pydantic BaseModel response classes from backend
  const pyModels = new Map<string, { fields: string[]; file: string; line: number }>();
  for (const [file, content] of ctx.fileContents) {
    if (!/\.py$/.test(file) || isTestFile(file)) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const modelMatch = lines[i].match(/class\s+(\w+(?:Out|Response|Result))\s*\(\s*(?:BaseModel|Base)\s*\)\s*:/);
      if (!modelMatch) continue;
      const name = modelMatch[1];
      const fields: string[] = [];
      for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
        if (/^\s*(?:class |def |@)/.test(lines[j])) break;
        const fieldMatch = lines[j].match(/^\s+(\w+)\s*:/);
        if (fieldMatch && !fieldMatch[1].startsWith('_')) fields.push(fieldMatch[1]);
      }
      if (fields.length > 0) {
        pyModels.set(name, { fields, file, line: i + 1 });
      }
    }
  }

  // Cross-match: find interfaces with same-ish names as Pydantic models
  for (const [tsName, tsInfo] of tsInterfaces) {
    for (const [pyName, pyInfo] of pyModels) {
      // Match by normalized name (e.g., EntityResponse ↔ EntityResponse, CompositeOut ↔ CompositeOut)
      if (tsName !== pyName) continue;

      const frontendOnly = tsInfo.fields.filter(f => !pyInfo.fields.includes(f));
      const backendOnly = pyInfo.fields.filter(f => !tsInfo.fields.includes(f));

      if (frontendOnly.length > 0) {
        result.findings.push(makeFinding({
          ruleId: 'FK-BE-SHAPE-001',
          title: `Frontend "${tsName}" expects ${frontendOnly.length} field(s) backend doesn't return`,
          categoryId: 'BE',
          severity: 'high',
          confidence: 'medium',
          labels: ['Broken', 'Schema Drift'],
          summary: `Frontend type "${tsName}" has fields [${frontendOnly.join(', ')}] that backend model "${pyName}" doesn't include.`,
          impact: 'Frontend will show undefined/null for these fields. Features relying on them are broken.',
          location: { file: tsInfo.file, startLine: tsInfo.line },
          codeSnippet: extractSnippet(ctx.fileContents, tsInfo.file, tsInfo.line, 0, Math.min(tsInfo.fields.length + 2, 12)),
          evidenceRefs: [
            `Frontend: ${tsInfo.file}:${tsInfo.line}`,
            `Backend: ${pyInfo.file}:${pyInfo.line}`,
            `Missing from backend: ${frontendOnly.join(', ')}`,
          ],
          suggestedFix: `Add [${frontendOnly.join(', ')}] to backend "${pyName}" or remove from frontend.`,
        }));
        result.smellHits.push(makeSmell('SMELL-SCHEMA-DRIFT', 'Frontend-backend schema drift', 1));
      }
    }
  }

  // ── 10. Commented-out router/route registrations (dead routes) ──
  for (const [file, content] of ctx.fileContents) {
    if (!/\.py$/.test(file) || isTestFile(file)) continue;
    const lines = content.split('\n');
    const commentedRoutes: { line: number; route: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Python: # app.include_router(...) or # router.include_router(...)
      const commentedRouter = line.match(/^\s*#\s*(app|router)\.(include_router|add_route|add_api_route)\s*\(/);
      if (commentedRouter) {
        const routeInfo = line.match(/include_router\s*\(\s*(\w+)/);
        commentedRoutes.push({ line: i + 1, route: routeInfo?.[1] || 'unknown' });
      }
      // JS/TS: // app.use('/api/...', router) or // router.use(...)
      const commentedUse = line.match(/^\s*\/\/\s*(app|router)\.(use|route)\s*\(/);
      if (commentedUse) {
        commentedRoutes.push({ line: i + 1, route: 'unknown' });
      }
    }

    if (commentedRoutes.length > 0) {
      result.findings.push(makeFinding({
        ruleId: 'FK-BE-DEAD-001',
        title: `${commentedRoutes.length} router registration(s) commented out`,
        categoryId: 'BE',
        severity: 'high',
        confidence: 'high',
        labels: ['Dead Control', 'Incomplete'],
        summary: `${file} has ${commentedRoutes.length} router(s) commented out: ${commentedRoutes.map(r => r.route).join(', ')}.`,
        impact: 'Frontend may call endpoints that are silently disabled. Users see 404 errors.',
        location: { file, startLine: commentedRoutes[0].line },
        codeSnippet: extractSnippet(ctx.fileContents, file, commentedRoutes[0].line, 1, 3),
        evidenceRefs: commentedRoutes.map(r => `${file}:${r.line} — ${r.route} disabled`),
        suggestedFix: 'Re-enable needed routes or remove them and their frontend callers.',
      }));
      result.smellHits.push(makeSmell('SMELL-DEAD-ROUTE', 'Dead route registration', commentedRoutes.length));
    }
  }

  // ── 11. Callback registration in useEffect without cleanup ──
  for (const [file, content] of ctx.fileContents) {
    if (!uiFilter(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (!/useEffect\s*\(/.test(lines[i])) continue;
      const effectBody = lines.slice(i, Math.min(i + 30, lines.length)).join('\n');

      // Detect callback registration patterns: .onX(callback), .registerCallback, etc.
      const hasCallbackReg = /\.\s*(?:on\w+Callback|register\w*|addCallback|setCallback|onExpired|onError|onSuccess)\s*\(/.test(effectBody);
      const hasCleanup = /return\s*\(\s*\)\s*=>|return\s+(?:function|\(\))/.test(effectBody);

      if (hasCallbackReg && !hasCleanup) {
        result.findings.push(makeFinding({
          ruleId: 'FK-FW-EFFECT-002',
          title: 'Callback registered in useEffect without cleanup',
          categoryId: 'FW',
          severity: 'medium',
          confidence: 'medium',
          labels: ['Fragile', 'Silent Failure'],
          summary: `${file}:${i + 1} registers a callback inside useEffect but never unregisters it on cleanup.`,
          impact: 'Callbacks accumulate on re-renders causing memory leaks and duplicate invocations.',
          location: { file, startLine: i + 1 },
          codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 0, 8),
          suggestedFix: 'Return a cleanup function that unregisters the callback.',
        }));
      }
    }
  }

  // ── 12. DB model fields not exposed through API response models ──
  // Detect when database models have important fields that never reach the API
  const dbModels = new Map<string, { fields: string[]; file: string; line: number }>();
  for (const [file, content] of ctx.fileContents) {
    if (!/\.py$/.test(file) || isTestFile(file)) continue;
    if (!/\bmodels?\b/i.test(file)) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // SQLAlchemy / SQLModel / Django model definitions
      const modelMatch = lines[i].match(/class\s+(\w+)\s*\(\s*(?:Base|Model|SQLModel|db\.Model)\s*\)\s*:/);
      if (!modelMatch) continue;
      const name = modelMatch[1];
      const fields: string[] = [];
      for (let j = i + 1; j < Math.min(i + 60, lines.length); j++) {
        if (/^\s*(?:class |def |@)/.test(lines[j]) && j > i + 1) break;
        const fieldMatch = lines[j].match(/^\s+(\w+)\s*(?::\s*|=\s*(?:Column|Field|mapped_column|db\.Column))/);
        if (fieldMatch && !fieldMatch[1].startsWith('_') && !/^(id|created_at|updated_at|tenant_id|metadata)$/.test(fieldMatch[1])) {
          fields.push(fieldMatch[1]);
        }
      }
      if (fields.length > 0) {
        dbModels.set(name, { fields, file, line: i + 1 });
      }
    }
  }

  // Check which DB fields appear in ANY API response builder
  const allApiCode = Array.from(ctx.fileContents.entries())
    .filter(([f]) => /\b(api|route|endpoint|views)\b/i.test(f) && /\.py$/.test(f))
    .map(([, c]) => c)
    .join('\n');

  for (const [modelName, modelInfo] of dbModels) {
    const unexposed = modelInfo.fields.filter(field => {
      // Check if this field appears in any API file
      const fieldRegex = new RegExp(`\\b${field}\\b`);
      return !fieldRegex.test(allApiCode);
    });

    if (unexposed.length >= 3) {
      result.findings.push(makeFinding({
        ruleId: 'FK-DM-EXPOSE-001',
        title: `DB model "${modelName}" has ${unexposed.length} fields not exposed via API`,
        categoryId: 'DM',
        severity: 'medium',
        confidence: 'low',
        labels: ['Incomplete'],
        summary: `"${modelName}" stores [${unexposed.slice(0, 5).join(', ')}${unexposed.length > 5 ? '...' : ''}] in the database but these fields never appear in API responses.`,
        impact: 'Data is stored but inaccessible to the frontend. Features may appear incomplete.',
        location: { file: modelInfo.file, startLine: modelInfo.line },
        codeSnippet: extractSnippet(ctx.fileContents, modelInfo.file, modelInfo.line, 0, Math.min(modelInfo.fields.length + 2, 12)),
        evidenceRefs: unexposed.slice(0, 8).map(f => `Not in API: ${modelName}.${f}`),
        suggestedFix: `Expose needed fields through the API response model, or document why they're internal-only.`,
      }));
    }
  }

  return result;
}
