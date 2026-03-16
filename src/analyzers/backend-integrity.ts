// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, makeSmell, emptyResult } from './base.js';
import { searchFiles, filesMatching, extractSnippet } from '../utils/patterns.js';
import { isTestFile } from '../utils/fs.js';

const serverFilter = (f: string) =>
  !isTestFile(f) && (
    /\b(api|server|route|action|controller|handler|middleware|mutation)\b/i.test(f) ||
    /\.(py|rb|go|rs|java|php)$/.test(f)
  );

const srcFilter = (f: string) => !isTestFile(f) && /\.(ts|tsx|js|jsx|py|rb|go|java|php)$/.test(f);

export function analyzeBackendIntegrity(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  // FK-BE-PERSIST-001: Writes that don't actually persist
  // Look for handlers that return success without DB writes
  const handlerFiles = filesMatching(ctx.fileContents, /(export\s+(default\s+)?function|export\s+const)\s+\w*(POST|PUT|PATCH|DELETE|create|update|save|delete|remove)/i, serverFilter);
  for (const file of handlerFiles) {
    const content = ctx.fileContents.get(file)!;
    const hasDbOp = /(prisma|db|knex|mongoose|sequelize|supabase|drizzle|sql|query|insert|update|\.save\(|\.create\(|\.update\(|\.delete\(|\.destroy\()/i.test(content);
    const hasResponse = /(return|res\.(json|send|status)|NextResponse|Response)/i.test(content);

    if (hasResponse && !hasDbOp) {
      result.findings.push(makeFinding({
        ruleId: 'FK-BE-PERSIST-001',
        title: 'Write handler may not persist data',
        categoryId: 'BE',
        severity: 'high',
        confidence: 'medium',
        labels: ['Fragile', 'Incomplete'],
        summary: `Handler in ${file} returns a response but has no visible database operation.`,
        impact: 'Data may not actually be saved.',
        location: { file },
        codeSnippet: extractSnippet(ctx.fileContents, file, 1, 0, 8),
        suggestedFix: 'Verify the handler connects to a real persistence layer.',
      }));
      result.smellHits.push(makeSmell('SMELL-DISCONNECTED-BACKEND', 'Disconnected backend', 1));
    }
  }

  // FK-BE-CONTRACT-001: Inconsistent response patterns
  const responsePatterns = searchFiles(
    ctx.fileContents,
    /res\.(json|send)\(\s*\{[^}]*\}\s*\)/,
    serverFilter,
  );
  // Check for inconsistent response shapes (success vs error)
  const successShapes = new Set<string>();
  const errorShapes = new Set<string>();
  for (const hit of responsePatterns) {
    if (/error|fail|400|401|403|404|500/i.test(hit.context)) {
      const shape = hit.context.replace(/['"`][^'"`]*['"`]/g, 'STR').replace(/\d+/g, 'NUM');
      errorShapes.add(shape);
    } else {
      const shape = hit.context.replace(/['"`][^'"`]*['"`]/g, 'STR').replace(/\d+/g, 'NUM');
      successShapes.add(shape);
    }
  }

  // FK-BE-ENDPOINT-001: fetch/axios calls to undefined endpoints
  // Collect frontend API calls — match various URL patterns
  const clientFetches = searchFiles(
    ctx.fileContents,
    /fetch\(\s*['"``]([^'"`]+)['"``]|axios\.\w+\(\s*['"``]([^'"`]+)['"``]|api\.\w+\(\s*['"``]([^'"`]+)['"``]/,
    (f) => !isTestFile(f) && /\.(tsx?|jsx?)$/.test(f),
  );

  // Collect all backend route paths from FastAPI/Express/Next.js
  const backendRoutes = new Set<string>();

  // Next.js file-based routes
  for (const f of ctx.files) {
    if (/\/api\//.test(f) && serverFilter(f)) {
      const match = f.match(/\/api\/(.+?)(?:\/route|\/index)?\.\w+$/);
      if (match) backendRoutes.add(`/api/${match[1]}`);
    }
  }

  // FastAPI/Express decorator-based routes
  for (const [file, content] of ctx.fileContents) {
    if (!/\.py$/.test(file) && !serverFilter(file)) continue;
    const lines = content.split('\n');

    // Collect router prefixes: router = APIRouter(prefix="/api/v1/foo")
    let routerPrefix = '';
    const prefixMatch = content.match(/APIRouter\s*\(\s*(?:.*?)prefix\s*=\s*['"`]([^'"`]+)['"`]/);
    if (prefixMatch) routerPrefix = prefixMatch[1];

    for (let i = 0; i < lines.length; i++) {
      // @router.get("/path"), @app.post("/path"), etc.
      const routeMatch = lines[i].match(/@(?:router|app)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/);
      if (routeMatch) {
        const path = routerPrefix + routeMatch[2];
        backendRoutes.add(path);
      }
      // Express: router.get("/path", ...) or app.post("/path", ...)
      const expressMatch = lines[i].match(/(?:router|app)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/);
      if (expressMatch) {
        backendRoutes.add(expressMatch[2]);
      }
    }
  }

  for (const hit of clientFetches) {
    const urlMatch = hit.match.match(/['"`]([^'"`]+?)['"`]/);
    if (!urlMatch) continue;
    let url = urlMatch[1].replace(/\?.*/, '').replace(/\/+$/, '');
    // Skip template strings with complex expressions, relative URLs, external URLs
    if (/\$\{/.test(url) || /^https?:\/\//.test(url) || !url.startsWith('/')) continue;

    // Normalize dynamic segments for matching: /api/v1/foo/123 -> /api/v1/foo/{id}
    const urlNorm = url.replace(/\/\d+/g, '/{id}');

    const exists = Array.from(backendRoutes).some(route => {
      const routeNorm = route.replace(/\{[^}]+\}/g, '{id}');
      return urlNorm === routeNorm || url === route || url.startsWith(route + '/') || route.startsWith(url);
    });

    if (!exists && backendRoutes.size > 0) {
      result.findings.push(makeFinding({
        ruleId: 'FK-BE-ENDPOINT-001',
        title: 'Client fetches endpoint that may not exist',
        categoryId: 'BE',
        severity: 'high',
        confidence: 'low',
        labels: ['Broken', 'Fake Flow'],
        summary: `Client calls ${url} but no matching API route was found.`,
        impact: 'Frontend action has no backend support.',
        location: { file: hit.file, startLine: hit.line },
        codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line),
        suggestedFix: 'Create the API endpoint or fix the URL.',
      }));
    }
  }

  // FK-BE-ORPHAN-001: Backend routes with no frontend caller
  if (backendRoutes.size > 0 && clientFetches.length > 0) {
    const calledUrls = new Set<string>();
    for (const hit of clientFetches) {
      const urlMatch = hit.match.match(/['"`]([^'"`]+?)['"`]/);
      if (urlMatch) calledUrls.add(urlMatch[1].replace(/\?.*/, '').replace(/\/+$/, ''));
    }
    // Also check for URL references in template literals
    const templateFetches = searchFiles(
      ctx.fileContents,
      /['"``]\/api\/v\d+\/[a-z_/-]+['"``]/,
      (f) => !isTestFile(f) && /\.(tsx?|jsx?)$/.test(f),
    );
    for (const hit of templateFetches) {
      const urlMatch = hit.match.match(/['"`]([^'"`]+?)['"`]/);
      if (urlMatch) calledUrls.add(urlMatch[1]);
    }
  }

  // FK-BE-HARDCODED-001: API endpoint returns hardcoded fallback
  const routeFilePattern = /(@router\.|@app\.|app\.(get|post|put|patch|delete)\(|router\.(get|post|put|patch|delete)\()/;
  const routeFiles = filesMatching(ctx.fileContents, routeFilePattern, srcFilter);

  for (const file of routeFiles) {
    // Skip health check files — they are SUPPOSED to return status data
    const fileName = file.split('/').pop() || '';
    if (/health/i.test(fileName)) continue;

    const content = ctx.fileContents.get(file);
    if (!content) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect except/catch blocks
      const isExceptBlock = /\b(except|catch)\b/.test(line);
      if (!isExceptBlock) continue;

      // Determine the indentation of the except/catch block
      const exceptIndent = (line.match(/^(\s*)/) || ['', ''])[1].length;

      // Scan the next several lines INSIDE the except/catch block only
      const blockLines = lines.slice(i + 1, Math.min(i + 10, lines.length));
      for (let j = 0; j < blockLines.length; j++) {
        const bLine = blockLines[j];

        // Stop scanning if we exit the except/catch block (same or less indentation)
        if (j > 0 && bLine.trim().length > 0) {
          const bIndent = (bLine.match(/^(\s*)/) || ['', ''])[1].length;
          if (bIndent <= exceptIndent) break;
        }

        // Stop if we hit another block statement
        if (/\b(except|catch|finally|def |function |class |async def)\b/.test(bLine) && j > 0) break;

        // Python: return {"status": "ok"} or return JSONResponse({...})
        const pyHardcoded = bLine.match(/return\s+(\{[^}]*\}|JSONResponse\s*\(\s*\{[^}]*\})/);
        // JS/TS: res.json({...}) or res.send({...})
        const jsHardcoded = bLine.match(/res\.(json|send|status\s*\(\s*\d+\s*\)\s*\.json)\s*\(\s*\{[^}]*\}/);

        if (pyHardcoded || jsHardcoded) {
          const matched = (pyHardcoded || jsHardcoded)![0];
          result.findings.push(makeFinding({
            ruleId: 'FK-BE-HARDCODED-001',
            title: 'API endpoint returns hardcoded fallback',
            categoryId: 'BE',
            severity: 'high',
            confidence: 'medium',
            labels: ['Misleading', 'Fake Flow'],
            summary: `Hardcoded response in except/catch block at ${file}:${i + j + 2}: ${matched.slice(0, 60)}`,
            impact: 'Endpoint returns static data when a dependency fails instead of surfacing the error.',
            location: { file, startLine: i + j + 2 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + j + 2, 3, 2),
            suggestedFix: 'Return a proper error response or re-raise the exception instead of swallowing it with fake data.',
          }));
          result.smellHits.push(makeSmell('SMELL-HARDCODED-FALLBACK', 'API returns hardcoded fallback', 1));
          break; // Only flag once per except/catch block
        }
      }
    }
  }

  return result;
}
