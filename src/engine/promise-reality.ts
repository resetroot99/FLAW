/**
 * Promise vs Reality Analysis
 * Compares what the README/docs claim vs what the code actually implements.
 */

import type { AnalyzerContext, Finding } from '../types/index.js';

export interface FeatureClaim {
  claim: string;
  source: string;
  status: 'implemented' | 'partial' | 'missing' | 'stub';
  evidence: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface PromiseReality {
  projectPurpose: string;
  claims: FeatureClaim[];
  implementedCount: number;
  partialCount: number;
  missingCount: number;
  stubCount: number;
  realityScore: number; // 0-100
  verdict: string;
}

// Keywords that indicate feature claims in README
const featurePatterns = [
  // Auth features
  { keywords: /\b(authentication|sign.?in|login|oauth|sso|jwt|session)\b/i, category: 'auth', label: 'Authentication / Login' },
  { keywords: /\b(authorization|rbac|role.?based|permissions?|access.?control)\b/i, category: 'authz', label: 'Authorization / Roles' },
  // Data features
  { keywords: /\b(real.?time|websocket|sse|live.?update|push.?notification|streaming)\b/i, category: 'realtime', label: 'Real-time Updates' },
  { keywords: /\b(search|full.?text|elastic|algolia|filter|query)\b/i, category: 'search', label: 'Search / Filtering' },
  { keywords: /\b(upload|file.?upload|image.?upload|s3|blob|storage)\b/i, category: 'upload', label: 'File Upload' },
  { keywords: /\b(export|download|csv|pdf|report.?generat)\b/i, category: 'export', label: 'Data Export' },
  { keywords: /\b(import|bulk.?import|csv.?import|data.?import)\b/i, category: 'import', label: 'Data Import' },
  // Payment
  { keywords: /\b(payment|stripe|billing|subscription|checkout|invoice)\b/i, category: 'payment', label: 'Payments / Billing' },
  // Communication
  { keywords: /\b(email|smtp|sendgrid|mailgun|notification|alert)\b/i, category: 'email', label: 'Email / Notifications' },
  { keywords: /\b(chat|messaging|inbox|conversation|direct.?message)\b/i, category: 'chat', label: 'Chat / Messaging' },
  // AI/ML
  { keywords: /\b(ai|machine.?learning|gpt|llm|openai|claude|embedding|vector)\b/i, category: 'ai', label: 'AI / Machine Learning' },
  // CRUD
  { keywords: /\b(dashboard|admin.?panel|cms|manage|crud)\b/i, category: 'dashboard', label: 'Dashboard / Admin' },
  { keywords: /\b(api|rest|graphql|endpoint|webhook)\b/i, category: 'api', label: 'API' },
  // Infrastructure
  { keywords: /\b(docker|kubernetes|ci.?cd|deploy|terraform|aws|gcp|azure)\b/i, category: 'infra', label: 'Deployment / Infrastructure' },
  { keywords: /\b(test|jest|pytest|cypress|playwright|e2e|unit.?test)\b/i, category: 'testing', label: 'Testing' },
  { keywords: /\b(monitoring|logging|analytics|metrics|sentry|datadog)\b/i, category: 'monitoring', label: 'Monitoring / Analytics' },
  // Collaboration
  { keywords: /\b(team|workspace|organization|multi.?tenant|collaboration)\b/i, category: 'collab', label: 'Teams / Multi-tenant' },
  { keywords: /\b(i18n|internationalization|localization|multi.?language|translate)\b/i, category: 'i18n', label: 'Internationalization' },
];

// Code patterns that indicate a feature is implemented
const implementationPatterns: Record<string, RegExp[]> = {
  auth: [
    /(?:signIn|login|authenticate|getSession|getUser|jwt\.sign|jwt\.verify|passport\.|OAuth|NextAuth|Depends\(.*auth)/i,
    /(?:bcrypt|argon2|hash.*password|compare.*password)/i,
  ],
  authz: [
    /(?:role|permission|isAdmin|canAccess|authorize|rbac|hasPermission|permission_classes)/i,
  ],
  realtime: [
    /(?:WebSocket|socket\.io|SSE|EventSource|useChannel|subscribe|onMessage|ws\.on)/i,
  ],
  search: [
    /(?:\.search\(|searchParams|useSearchParams|filter\(|\.find\(|WHERE.*LIKE|ILIKE|elasticsearch|algolia)/i,
  ],
  upload: [
    /(?:multer|formidable|multipart|UploadFile|FileField|<input.*type.*file|dropzone|upload)/i,
  ],
  export: [
    /(?:csv|xlsx|pdf|export|download|Blob|createObjectURL|writeFile|Content-Disposition)/i,
  ],
  import: [
    /(?:csv.*parse|xlsx.*read|bulk.*insert|import.*data|upload.*csv)/i,
  ],
  payment: [
    /(?:stripe|Stripe|paypal|checkout\.sessions|subscription|invoice|price_id|payment_intent)/i,
  ],
  email: [
    /(?:sendgrid|mailgun|nodemailer|smtp|send.*email|send.*mail|email.*template|EmailMessage)/i,
  ],
  chat: [
    /(?:message|chat|conversation|inbox|sendMessage|onMessage|MessageList|ChatInput)/i,
  ],
  ai: [
    /(?:openai|anthropic|ChatCompletion|embedding|vector|llm|generateText|useChat|streamText)/i,
  ],
  dashboard: [
    /(?:dashboard|admin|DataTable|Chart|Graph|analytics|stats|overview|metric)/i,
  ],
  api: [
    /(?:router\.|app\.(get|post|put|delete)|@app\.|@router\.|APIRouter|express\(\)|FastAPI)/i,
  ],
  infra: [
    /(?:Dockerfile|docker-compose|\.github\/workflows|terraform|serverless|vercel\.json|netlify)/i,
  ],
  testing: [
    /(?:describe\(|it\(|test\(|expect\(|assert|pytest|@pytest|unittest|cy\.|page\.)/i,
  ],
  monitoring: [
    /(?:sentry|datadog|newrelic|pino|winston|logger\.|console\.(?!log)|metrics|Sentry\.init)/i,
  ],
  collab: [
    /(?:team|workspace|org|tenant|member|invite|collaboration|multi.?tenant)/i,
  ],
  i18n: [
    /(?:i18n|t\(|useTranslation|formatMessage|IntlProvider|locale|gettext)/i,
  ],
};

export function analyzePromiseVsReality(ctx: AnalyzerContext, findings: Finding[]): PromiseReality {
  // Find README content
  let readmeContent = '';
  let readmeFile = '';
  for (const [file, content] of ctx.fileContents) {
    if (/^readme\.md$/i.test(file.split('/').pop() || '')) {
      readmeContent = content;
      readmeFile = file;
      break;
    }
  }

  // Also check package.json description
  let pkgDescription = '';
  const pkgContent = ctx.fileContents.get('package.json');
  if (pkgContent) {
    const descMatch = pkgContent.match(/"description"\s*:\s*"([^"]+)"/);
    if (descMatch) pkgDescription = descMatch[1];
  }

  // Also check pyproject.toml
  const pyproject = ctx.fileContents.get('pyproject.toml');
  if (pyproject) {
    const descMatch = pyproject.match(/description\s*=\s*"([^"]+)"/);
    if (descMatch && !pkgDescription) pkgDescription = descMatch[1];
  }

  const sourceText = readmeContent + '\n' + pkgDescription;

  // Detect project purpose
  let projectPurpose = pkgDescription || 'Unknown project purpose';
  if (readmeContent) {
    // Try to get the first meaningful paragraph after the title
    const lines = readmeContent.split('\n');
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith('#') && !line.startsWith('!') && !line.startsWith('[') &&
          !line.startsWith('```') && !line.startsWith('|') && !line.startsWith('-') &&
          line.length > 30) {
        projectPurpose = line.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        break;
      }
    }
  }

  // Check which features are claimed in the README
  const claims: FeatureClaim[] = [];
  const seenCategories = new Set<string>();

  for (const pattern of featurePatterns) {
    if (!pattern.keywords.test(sourceText)) continue;
    if (seenCategories.has(pattern.category)) continue;
    seenCategories.add(pattern.category);

    // Check if this feature is implemented in the codebase
    const implPatterns = implementationPatterns[pattern.category] || [];
    let implementedFiles = 0;
    let stubFiles = 0;
    let totalMatches = 0;
    const matchedFiles: string[] = [];

    for (const [file, content] of ctx.fileContents) {
      if (/node_modules|\.test\.|\.spec\.|__tests__|\.md$/i.test(file)) continue;
      for (const ip of implPatterns) {
        if (ip.test(content)) {
          totalMatches++;
          matchedFiles.push(file);
          // Check if it's a stub
          const isStub = /pass\s*$|return\s+None|TODO|FIXME|not\s*implemented/im.test(content);
          if (isStub) stubFiles++; else implementedFiles++;
          break;
        }
      }
    }

    // Check if findings reference this category
    const relatedFindings = findings.filter(f => {
      const title = (f.title + ' ' + f.summary).toLowerCase();
      return pattern.keywords.test(title);
    });

    let status: FeatureClaim['status'];
    let evidence: string;
    let confidence: FeatureClaim['confidence'];

    if (totalMatches === 0) {
      status = 'missing';
      evidence = `README mentions ${pattern.label} but no implementation found in code.`;
      confidence = 'medium';
    } else if (stubFiles > 0 && implementedFiles === 0) {
      status = 'stub';
      evidence = `Found in ${matchedFiles.slice(0, 3).join(', ')} but code appears to be stubs/placeholders.`;
      confidence = 'medium';
    } else if (relatedFindings.length > 2) {
      status = 'partial';
      evidence = `Found in ${implementedFiles} file${implementedFiles > 1 ? 's' : ''} but has ${relatedFindings.length} open issues.`;
      confidence = 'high';
    } else if (implementedFiles > 0) {
      status = 'implemented';
      evidence = `Found in ${matchedFiles.slice(0, 3).join(', ')}.`;
      confidence = totalMatches >= 3 ? 'high' : 'medium';
    } else {
      status = 'missing';
      evidence = 'No matching code patterns found.';
      confidence = 'low';
    }

    claims.push({ claim: pattern.label, source: readmeFile || 'package.json', status, evidence, confidence });
  }

  const implementedCount = claims.filter(c => c.status === 'implemented').length;
  const partialCount = claims.filter(c => c.status === 'partial').length;
  const missingCount = claims.filter(c => c.status === 'missing').length;
  const stubCount = claims.filter(c => c.status === 'stub').length;
  const total = claims.length || 1;

  const realityScore = Math.round(((implementedCount + partialCount * 0.5) / total) * 100);

  let verdict: string;
  if (realityScore >= 80) {
    verdict = 'The project delivers on most of what it promises. Focus on finishing partial implementations.';
  } else if (realityScore >= 50) {
    verdict = 'About half of the promised features are working. Several key features are incomplete or missing.';
  } else if (realityScore >= 20) {
    verdict = 'Most promised features are missing or stubbed out. The project is more concept than product.';
  } else {
    verdict = 'Very little of what\'s promised is actually implemented. This is a prototype, not a product.';
  }

  return {
    projectPurpose,
    claims,
    implementedCount,
    partialCount,
    missingCount,
    stubCount,
    realityScore,
    verdict,
  };
}
