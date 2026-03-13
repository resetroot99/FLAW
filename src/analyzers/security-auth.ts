// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, makeSmell, emptyResult } from './base.js';
import { searchFiles, filesMatching, countPattern, extractSnippet } from '../utils/patterns.js';
import { isTestFile } from '../utils/fs.js';

const srcFilter = (f: string) => !isTestFile(f) && /\.(ts|tsx|js|jsx|py|rb|go|java|php)$/.test(f);
const serverFilter = (f: string) => srcFilter(f) && /\b(api|server|route|action|controller|handler|middleware|mutation|views|endpoints)\b/i.test(f);

export function analyzeSecurityAuth(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  // FK-SA-SECRET-001: Secrets in source code
  const secretPatterns = [
    { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"`][A-Za-z0-9_\-]{20,}['"`]/i, label: 'API key' },
    { pattern: /(?:secret|token|password|passwd|pwd)\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/i, label: 'Secret/token' },
    { pattern: /sk[_-](?:live|test)[_-][A-Za-z0-9]{20,}/i, label: 'Stripe key' },
    { pattern: /ghp_[A-Za-z0-9]{36}/i, label: 'GitHub PAT' },
    { pattern: /AKIA[A-Z0-9]{16}/i, label: 'AWS access key' },
    { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i, label: 'Private key' },
  ];

  for (const { pattern, label } of secretPatterns) {
    const hits = searchFiles(ctx.fileContents, pattern, (f) => srcFilter(f) && !/\.env/.test(f) && !isTestFile(f));
    for (const hit of hits) {
      // Skip if it's clearly a placeholder
      if (/your[_-]|xxx|placeholder|example|dummy|process\.env|import\.meta\.env|os\.environ/i.test(hit.context)) continue;
      result.findings.push(makeFinding({
        ruleId: 'FK-SA-SECRET-001',
        title: `Potential ${label} exposed in source code`,
        categoryId: 'SA',
        severity: 'critical',
        confidence: 'medium',
        labels: ['Unsafe', 'Production-Blocking'],
        summary: `Possible ${label} found in ${hit.file}:${hit.line}.`,
        impact: 'Exposed secrets enable unauthorized access.',
        location: { file: hit.file, startLine: hit.line },
        codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line, 1, 1),
        suggestedFix: 'Rotate the secret, remove from source, use environment variables.',
      }));
    }
  }

  // FK-SA-AUTH-001: Server routes without auth checks
  const serverFiles = filesMatching(ctx.fileContents, /(export\s+(default\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)|app\.(get|post|put|patch|delete)|router\.(get|post|put|patch|delete)|@app\.(get|post|put|patch|delete)|@router\.(get|post|put|patch|delete))/i, serverFilter);
  for (const file of serverFiles) {
    const content = ctx.fileContents.get(file)!;

    // JS/TS auth patterns
    const hasJsAuth = /(getSession|getServerSession|getUser|auth\(\)|requireAuth|isAuthenticated|verifyToken|jwt\.verify|passport\.authenticate|getToken|currentUser|session\.|req\.user|ctx\.user)/i.test(content);

    // Python/FastAPI auth patterns — Depends() injection with auth-related callables
    const hasPythonAuth = /(Depends\s*\(\s*\w*(auth|user|token|session|permission|role|current_user|get_current|verify|require_auth|get_db_session|check_permission)\w*|Security\s*\(|HTTPBearer|OAuth2PasswordBearer|api_key_header|get_current_user|require_role|check_tenant)/i.test(content);

    // Token passed via Query/Header parameter (common pattern for SSE/WebSocket endpoints)
    const hasTokenParam = /token\s*:\s*str\s*=\s*(Query|Header)\s*\(/i.test(content);

    // Python decorator-based auth
    const hasDecoratorAuth = /@(login_required|permission_required|roles_required|auth_required|jwt_required|protected)/i.test(content);

    // Django auth patterns
    const hasDjangoAuth = /(LoginRequiredMixin|PermissionRequiredMixin|IsAuthenticated|permission_classes|authentication_classes)/i.test(content);

    const hasAuthCheck = hasJsAuth || hasPythonAuth || hasDecoratorAuth || hasDjangoAuth || hasTokenParam;

    // Public path detection — match only file/directory names, not substrings
    const pathParts = file.split('/');
    const fileName = pathParts[pathParts.length - 1].replace(/\.\w+$/, ''); // strip extension
    const isPublicPath = /^(login|signup|register|health|health_check|ping|docs|openapi|redoc|public|webhook|callback|well-known|verify|status|version|manifest)$/i.test(fileName);

    // Also check for explicit public markers in the code
    const hasPublicMarker = /@(public|allow_anonymous|skipAuth|no_auth)/i.test(content) ||
      /# public endpoint|# no auth|# unauthenticated/i.test(content);

    if (!hasAuthCheck && !isPublicPath && !hasPublicMarker) {
      // Find first route definition line for the snippet
      const lines = content.split('\n');
      let routeLine = 0;
      for (let i = 0; i < lines.length; i++) {
        if (/(app\.(get|post|put|patch|delete)|router\.(get|post|put|patch|delete)|@(app|router)\.(get|post|put|patch|delete)|export\s+(default\s+)?function\s+(GET|POST|PUT|PATCH|DELETE))/i.test(lines[i])) {
          routeLine = i + 1;
          break;
        }
      }

      result.findings.push(makeFinding({
        ruleId: 'FK-SA-AUTH-001',
        title: 'Server route may lack authentication',
        categoryId: 'SA',
        severity: 'high',
        confidence: 'medium',
        labels: ['Auth Gap', 'Unsafe'],
        summary: `${file} has route handlers without visible auth checks.`,
        impact: 'Unauthenticated users may access protected data.',
        location: { file, startLine: routeLine || undefined },
        codeSnippet: routeLine ? extractSnippet(ctx.fileContents, file, routeLine, 1, 5) : undefined,
        suggestedFix: 'Add server-side authentication checks.',
      }));
      result.smellHits.push(makeSmell('SMELL-AUTH-IN-UI-ONLY', 'Auth in UI only', 1));
    }
  }

  // FK-SA-AUTHZ-001: Resource access by raw ID without ownership check
  const rawIdAccess = searchFiles(
    ctx.fileContents,
    /params\.(id|userId|orgId|teamId)|req\.params\.\w*[iI]d|searchParams\.get\(['"`]id['"`]\)/,
    serverFilter,
  );
  for (const hit of rawIdAccess) {
    const content = ctx.fileContents.get(hit.file)!;
    const lines = content.split('\n');
    const region = lines.slice(Math.max(0, hit.line - 5), Math.min(lines.length, hit.line + 15)).join('\n');
    const hasOwnershipCheck = /(where.*userId|where.*ownerId|where.*orgId|where.*tenantId|belongsTo|\.filter\(.*user|session.*id.*===)/i.test(region);

    if (!hasOwnershipCheck) {
      result.findings.push(makeFinding({
        ruleId: 'FK-SA-AUTHZ-001',
        title: 'Resource lookup by ID without ownership check',
        categoryId: 'SA',
        severity: 'high',
        confidence: 'low',
        labels: ['Auth Gap', 'Unsafe'],
        summary: `ID-based resource access at ${hit.file}:${hit.line} without visible ownership verification.`,
        impact: 'Users may access resources they do not own.',
        location: { file: hit.file, startLine: hit.line },
        codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line, 2, 4),
        suggestedFix: 'Add ownership or tenant scoping to the query.',
      }));
    }
  }

  // XSS: dangerouslySetInnerHTML (only in component/template files, skip analyzer code)
  const xssHits = searchFiles(ctx.fileContents, /dangerouslySetInnerHTML|v-html\s*=|\.innerHTML\s*=/, (f) => srcFilter(f) && /\.(tsx|jsx|vue|svelte|html)$/.test(f));
  for (const hit of xssHits) {
    // Skip if it's inside a regex or string (analyzer/test code)
    if (/\/.*innerHTML.*\/|['"`].*innerHTML.*['"`]/.test(hit.context)) continue;
    result.findings.push(makeFinding({
      ruleId: 'FK-SA-INPUT-001',
      title: 'Unescaped HTML injection risk',
      categoryId: 'SA',
      severity: 'medium',
      confidence: 'high',
      labels: ['Unsafe'],
      summary: `Raw HTML rendering at ${hit.file}:${hit.line}.`,
      impact: 'XSS risk if user-controlled content is rendered.',
      location: { file: hit.file, startLine: hit.line },
      codeSnippet: extractSnippet(ctx.fileContents, hit.file, hit.line),
      suggestedFix: 'Sanitize content before rendering or use safe alternatives.',
    }));
  }

  // .env files committed — but skip if .gitignore already covers .env
  const gitignoreContent = ctx.fileContents.get('.gitignore') || '';
  const envIgnored = /^\s*\.env\b/m.test(gitignoreContent);
  if (!envIgnored) {
    const envFiles = Array.from(ctx.fileContents.keys()).filter(f => /^\.env(?!\.example|\.sample|\.template)/.test(f.split('/').pop() || ''));
    for (const file of envFiles) {
      const content = ctx.fileContents.get(file)!;
      const hasRealValues = /(?:KEY|SECRET|TOKEN|PASSWORD|PRIVATE)\s*=\s*[^\s$]{8,}/i.test(content);
      if (hasRealValues) {
        result.findings.push(makeFinding({
          ruleId: 'FK-SA-SECRET-001',
          title: '.env file with real secrets may be committed',
          categoryId: 'SA',
          severity: 'critical',
          confidence: 'high',
          labels: ['Unsafe', 'Production-Blocking'],
          summary: `${file} appears to contain real secrets.`,
          impact: 'Secrets in repo are exposed to anyone with repo access.',
          location: { file },
          suggestedFix: 'Add .env to .gitignore and rotate exposed secrets.',
        }));
      }
    }
  }

  return result;
}
