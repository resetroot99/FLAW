// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, makeSmell, emptyResult } from './base.js';
import { searchFiles, extractSnippet } from '../utils/patterns.js';
import { isTestFile } from '../utils/fs.js';

const srcFilter = (f: string) => !isTestFile(f) && /\.(ts|tsx|js|jsx|py|rb|go|java|php)$/.test(f);

const backendFilter = (f: string) =>
  !isTestFile(f) && (
    /\b(api|server|route|action|controller|handler|middleware|mutation|app|main|config|db|database|connect|client)\b/i.test(f) ||
    /\.(py|rb|go|rs|java|php)$/.test(f)
  );

export function analyzeHealthSurface(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  // ── FK-HS-ENVEMPTY-001: Multiple env vars with empty defaults ──────────
  // Detects os.getenv("VAR", ""), os.environ.get("VAR", ""),
  // process.env.VAR || "", process.env.VAR ?? ""
  const envEmptyPattern =
    /os\.getenv\(\s*['"][^'"]+['"]\s*,\s*['"]{2}\s*\)|os\.environ\.get\(\s*['"][^'"]+['"]\s*,\s*['"]{2}\s*\)|process\.env\.\w+\s*\|\|\s*['"]{2}|process\.env\.\w+\s*\?\?\s*['"]{2}/;

  const envEmptyHits = searchFiles(ctx.fileContents, envEmptyPattern, srcFilter);

  // Count per-file
  const envEmptyByFile = new Map<string, number>();
  for (const hit of envEmptyHits) {
    envEmptyByFile.set(hit.file, (envEmptyByFile.get(hit.file) || 0) + 1);
  }

  const totalEnvEmpty = envEmptyHits.length;
  if (totalEnvEmpty >= 3) {
    const severity = totalEnvEmpty >= 5 ? 'high' : 'medium';
    const topFile = [...envEmptyByFile.entries()].sort((a, b) => b[1] - a[1])[0];
    const firstHit = envEmptyHits[0];

    result.findings.push(makeFinding({
      ruleId: 'FK-HS-ENVEMPTY-001',
      title: 'Multiple env vars with empty defaults hiding degradation',
      categoryId: 'DO',
      severity,
      confidence: 'high',
      labels: ['Silent Failure', 'Fragile'],
      summary: `Found ${totalEnvEmpty} env vars defaulting to empty strings across ${envEmptyByFile.size} file(s). Worst: ${topFile[0]} (${topFile[1]} vars).`,
      impact: 'App silently degrades when env vars are missing instead of failing fast at startup.',
      location: { file: firstHit.file, startLine: firstHit.line },
      codeSnippet: extractSnippet(ctx.fileContents, firstHit.file, firstHit.line),
      suggestedFix: 'Validate required env vars at startup and throw an error if missing. Use a config module with strict validation (e.g., pydantic BaseSettings or envalid).',
    }));
    result.smellHits.push(makeSmell('SMELL-SILENT-DEGRADATION', 'Silent degradation', totalEnvEmpty));
  }

  // ── FK-HS-NOHEALTH-001: No health check endpoint ──────────────────────
  const healthPattern = /['"\/](health|healthz|status|ready|readiness|liveness)['"\/\s)]/i;
  const healthRouteDecoratorPattern = /@(?:router|app)\.\w+\(\s*['"][^'"]*\/(health|healthz|status|ready|readiness|liveness)/i;
  const expressHealthPattern = /(?:router|app)\.\w+\(\s*['"][^'"]*\/(health|healthz|status|ready|readiness|liveness)/i;

  let hasHealthEndpoint = false;
  let hasBackendRoutes = false;

  for (const [file, content] of ctx.fileContents) {
    if (!backendFilter(file)) continue;

    // Check if this file defines routes
    const isRouteFile = /@(?:router|app)\.(get|post|put|patch|delete)\(/.test(content) ||
      /(?:router|app)\.(get|post|put|patch|delete)\(/.test(content) ||
      /\/api\//.test(file);

    if (isRouteFile) hasBackendRoutes = true;

    if (healthRouteDecoratorPattern.test(content) ||
        expressHealthPattern.test(content) ||
        healthPattern.test(content)) {
      hasHealthEndpoint = true;
    }
  }

  // Also check file paths for health endpoints (Next.js style)
  for (const f of ctx.files) {
    if (/\/(health|healthz|status|ready|readiness|liveness)\b/i.test(f) && /\.(ts|js|py)$/.test(f)) {
      hasHealthEndpoint = true;
    }
  }

  if (hasBackendRoutes && !hasHealthEndpoint) {
    result.findings.push(makeFinding({
      ruleId: 'FK-HS-NOHEALTH-001',
      title: 'No health check endpoint',
      categoryId: 'DO',
      severity: 'medium',
      confidence: 'high',
      labels: ['Incomplete', 'Fragile'],
      summary: 'Project defines backend routes but has no /health, /healthz, /status, /ready, or /liveness endpoint.',
      impact: 'Load balancers and orchestrators cannot verify service health. Failures may go undetected in production.',
      location: { file: ctx.files.find(f => backendFilter(f)) || ctx.files[0] },
      suggestedFix: 'Add a /health or /healthz endpoint that checks database connectivity and returns 200 when healthy.',
    }));
    result.smellHits.push(makeSmell('SMELL-NO-OBSERVABILITY', 'No observability', 1));
  }

  // ── FK-HS-CONNECTSKIP-001: Connection wrapped in try/catch returning None/null ──
  // Python: try: ... = create_engine(...) except: ... = None
  // JS/TS: try { ... = new Client(...) } catch { ... = null }
  for (const [file, content] of ctx.fileContents) {
    if (!srcFilter(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Python pattern: look for try block, then connection-creating code,
      // then except block that assigns None
      if (/^\s*try\s*:/.test(line)) {
        // Scan the try block and following except block (up to 20 lines)
        const blockEnd = Math.min(i + 20, lines.length);
        let hasConnectionCreate = false;
        let noneAssignLine = -1;
        let inExcept = false;

        for (let j = i + 1; j < blockEnd; j++) {
          const bline = lines[j];
          // Detect connection-creating calls
          if (!inExcept && /\b(create_engine|connect|MongoClient|psycopg2\.connect|redis\.Redis|aiohttp\.ClientSession|httpx\.Client|AsyncClient)\s*\(/.test(bline)) {
            hasConnectionCreate = true;
          }
          if (/^\s*except\b/.test(bline)) {
            inExcept = true;
          }
          // In except block, check for assignment to None
          if (inExcept && /=\s*None\s*$/.test(bline)) {
            noneAssignLine = j;
            break;
          }
          // Stop if we hit another try or a def/class
          if (j > i + 1 && /^\s*(try\s*:|def |class )/.test(bline)) break;
        }

        if (hasConnectionCreate && noneAssignLine > 0) {
          result.findings.push(makeFinding({
            ruleId: 'FK-HS-CONNECTSKIP-001',
            title: 'Service connection silently swallowed on failure',
            categoryId: 'EH',
            severity: 'high',
            confidence: 'high',
            labels: ['Silent Failure', 'Fragile'],
            summary: `Connection attempt in ${file} catches failure and sets variable to None. The app will run without this service.`,
            impact: 'Service silently disappears on connection failure. Downstream code may crash or produce wrong results.',
            location: { file, startLine: i + 1, endLine: noneAssignLine + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 0, Math.min(noneAssignLine - i + 2, 12)),
            suggestedFix: 'Fail fast on connection errors at startup, or implement a retry strategy with proper logging and alerting.',
          }));
          result.smellHits.push(makeSmell('SMELL-SILENT-DEGRADATION', 'Silent degradation', 1));
        }
      }

      // JS/TS pattern: try { ... = new Client/Pool/... } catch { ... = null }
      if (/^\s*try\s*\{/.test(line)) {
        const blockEnd = Math.min(i + 20, lines.length);
        let hasConnectionCreate = false;
        let nullAssignLine = -1;
        let inCatch = false;

        for (let j = i + 1; j < blockEnd; j++) {
          const bline = lines[j];
          if (!inCatch && /\bnew\s+(Client|Pool|MongoClient|Redis|PrismaClient|Sequelize|Knex|Connection)\s*\(/.test(bline)) {
            hasConnectionCreate = true;
          }
          if (/\bcatch\b/.test(bline)) {
            inCatch = true;
          }
          if (inCatch && /=\s*null\s*[;]?\s*$/.test(bline)) {
            nullAssignLine = j;
            break;
          }
          if (j > i + 1 && /^\s*(try\s*\{|function |class )/.test(bline)) break;
        }

        if (hasConnectionCreate && nullAssignLine > 0) {
          result.findings.push(makeFinding({
            ruleId: 'FK-HS-CONNECTSKIP-001',
            title: 'Service connection silently swallowed on failure',
            categoryId: 'EH',
            severity: 'high',
            confidence: 'high',
            labels: ['Silent Failure', 'Fragile'],
            summary: `Connection attempt in ${file} catches failure and sets variable to null. The app will run without this service.`,
            impact: 'Service silently disappears on connection failure. Downstream code may crash or produce wrong results.',
            location: { file, startLine: i + 1, endLine: nullAssignLine + 1 },
            codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 0, Math.min(nullAssignLine - i + 2, 12)),
            suggestedFix: 'Fail fast on connection errors at startup, or implement a retry strategy with proper logging and alerting.',
          }));
          result.smellHits.push(makeSmell('SMELL-SILENT-DEGRADATION', 'Silent degradation', 1));
        }
      }
    }
  }

  // ── FK-HS-ENVSKIP-001: Connector silently skips when env var empty ─────
  // Pattern: env var read with empty default, then within 10 lines: if not var: return / if (!var) return
  for (const [file, content] of ctx.fileContents) {
    if (!srcFilter(file)) continue;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Python: var = os.getenv("X", "") or var = os.environ.get("X", "")
      const pyMatch = line.match(/(\w+)\s*=\s*os\.(?:getenv|environ\.get)\(\s*['"][^'"]+['"]\s*,\s*['"]{2}\s*\)/);
      if (pyMatch) {
        const varName = pyMatch[1];
        const lookAhead = Math.min(i + 10, lines.length);
        for (let j = i + 1; j < lookAhead; j++) {
          // if not var_name: return or if not var_name:\n    return
          if (new RegExp(`if\\s+not\\s+${varName}\\s*:`).test(lines[j]) &&
              (/return/.test(lines[j]) || (j + 1 < lines.length && /^\s+return/.test(lines[j + 1])))) {
            result.findings.push(makeFinding({
              ruleId: 'FK-HS-ENVSKIP-001',
              title: 'Connector silently skips when env var is empty',
              categoryId: 'EH',
              severity: 'high',
              confidence: 'high',
              labels: ['Silent Failure', 'Fragile'],
              summary: `${file}: "${varName}" defaults to empty string, then silently returns if empty. The connector disappears without any error.`,
              impact: 'An entire service connector can vanish silently if the env var is not set. No log, no error, no alert.',
              location: { file, startLine: i + 1, endLine: j + 1 },
              codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 0, j - i + 2),
              suggestedFix: 'Raise an error or log a warning when a required env var is missing. Use strict config validation at startup.',
            }));
            result.smellHits.push(makeSmell('SMELL-SILENT-DEGRADATION', 'Silent degradation', 1));
            break;
          }
        }
      }

      // JS/TS: const varName = process.env.VAR || "" or ?? ""
      const jsMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*process\.env\.\w+\s*(?:\|\||[?]{2})\s*['"]{2}/);
      if (jsMatch) {
        const varName = jsMatch[1];
        const lookAhead = Math.min(i + 10, lines.length);
        for (let j = i + 1; j < lookAhead; j++) {
          // if (!varName) return or if (!varName) { return }
          if (new RegExp(`if\\s*\\(!\\s*${varName}\\s*\\)\\s*return`).test(lines[j]) ||
              (new RegExp(`if\\s*\\(!\\s*${varName}\\s*\\)`).test(lines[j]) &&
               j + 1 < lines.length && /^\s*return/.test(lines[j + 1]))) {
            result.findings.push(makeFinding({
              ruleId: 'FK-HS-ENVSKIP-001',
              title: 'Connector silently skips when env var is empty',
              categoryId: 'EH',
              severity: 'high',
              confidence: 'high',
              labels: ['Silent Failure', 'Fragile'],
              summary: `${file}: "${varName}" defaults to empty string, then silently returns if empty. The connector disappears without any error.`,
              impact: 'An entire service connector can vanish silently if the env var is not set. No log, no error, no alert.',
              location: { file, startLine: i + 1, endLine: j + 1 },
              codeSnippet: extractSnippet(ctx.fileContents, file, i + 1, 0, j - i + 2),
              suggestedFix: 'Raise an error or log a warning when a required env var is missing. Use strict config validation at startup.',
            }));
            result.smellHits.push(makeSmell('SMELL-SILENT-DEGRADATION', 'Silent degradation', 1));
            break;
          }
        }
      }
    }
  }

  return result;
}
