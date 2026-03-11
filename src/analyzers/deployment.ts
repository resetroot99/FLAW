import type { AnalyzerContext, AnalyzerResult } from '../types/index.js';
import { makeFinding, emptyResult } from './base.js';
import { isTestFile } from '../utils/fs.js';

export function analyzeDeployment(ctx: AnalyzerContext): AnalyzerResult {
  const result = emptyResult();

  const fileSet = new Set(ctx.files);

  // FK-DO-SETUP-001: Missing README
  const hasReadme = ctx.files.some(f => /^readme\.(md|txt|rst)$/i.test(f));
  if (!hasReadme && ctx.files.length > 10) {
    result.findings.push(makeFinding({
      ruleId: 'FK-DO-SETUP-001',
      title: 'No README file',
      categoryId: 'DO',
      severity: 'medium',
      confidence: 'high',
      labels: ['Incomplete'],
      summary: 'Project has no README for setup instructions.',
      impact: 'New developers cannot onboard without oral tradition.',
      location: { file: '.' },
      suggestedFix: 'Add a README with setup, run, and deployment instructions.',
    }));
  }

  // FK-DO-ENV-001: No .env.example
  const hasEnvExample = ctx.files.some(f => /\.env\.(example|sample|template)$/i.test(f));
  const hasEnvUsage = Array.from(ctx.fileContents.values()).some(c =>
    /process\.env\.\w+|import\.meta\.env\.\w+|os\.environ/i.test(c)
  );
  if (hasEnvUsage && !hasEnvExample) {
    result.findings.push(makeFinding({
      ruleId: 'FK-DO-ENV-001',
      title: 'Environment variables used but no .env.example provided',
      categoryId: 'DO',
      severity: 'medium',
      confidence: 'high',
      labels: ['Incomplete'],
      summary: 'Code references env vars but no example env file exists.',
      impact: 'New developers must guess required configuration.',
      location: { file: '.' },
      suggestedFix: 'Create a .env.example listing all required variables.',
    }));
  }

  // FK-DO-CI-001: No CI configuration
  const hasCi = ctx.files.some(f =>
    /\.github\/workflows\//.test(f) ||
    /\.gitlab-ci\.yml/.test(f) ||
    /Jenkinsfile/.test(f) ||
    /\.circleci\//.test(f) ||
    /bitbucket-pipelines\.yml/.test(f)
  );
  if (!hasCi && ctx.files.length > 20) {
    result.findings.push(makeFinding({
      ruleId: 'FK-DO-CI-001',
      title: 'No CI/CD configuration found',
      categoryId: 'DO',
      severity: 'medium',
      confidence: 'high',
      labels: ['Incomplete'],
      summary: 'No CI/CD pipeline configuration detected.',
      impact: 'No automated checks on code changes.',
      location: { file: '.' },
      suggestedFix: 'Add CI config to run lint, typecheck, and tests on push.',
    }));
  }

  // FK-DO-SETUP-001: No lockfile
  const hasLockfile = ctx.files.some(f =>
    /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Gemfile\.lock|poetry\.lock|go\.sum|Cargo\.lock)$/.test(f)
  );
  const hasPackageJson = fileSet.has('package.json');
  if (hasPackageJson && !hasLockfile) {
    result.findings.push(makeFinding({
      ruleId: 'FK-DO-SETUP-001',
      title: 'No lockfile committed',
      categoryId: 'DO',
      severity: 'medium',
      confidence: 'high',
      labels: ['Fragile'],
      summary: 'package.json exists but no lockfile is committed.',
      impact: 'Builds may not be reproducible across environments.',
      location: { file: 'package.json' },
      suggestedFix: 'Commit the lockfile for your package manager.',
    }));
  }

  // FK-DO-LOGS-001: No structured logging
  const hasLogger = Array.from(ctx.fileContents.values()).some(c =>
    /\b(winston|pino|bunyan|log4js|logger\.|logging\.getLogger|structlog|slog\.)/i.test(c)
  );
  const sourceCount = ctx.files.filter(f => /\.(ts|tsx|js|jsx|py|rb|go)$/.test(f) && !isTestFile(f)).length;
  if (!hasLogger && sourceCount > 20) {
    result.findings.push(makeFinding({
      ruleId: 'FK-DO-LOGS-001',
      title: 'No structured logging library detected',
      categoryId: 'DO',
      severity: 'low',
      confidence: 'medium',
      labels: ['Incomplete'],
      summary: 'Project uses console.log but no structured logging.',
      impact: 'Production debugging will be harder without structured logs.',
      location: { file: '.' },
      suggestedFix: 'Add a structured logger (pino, winston, etc.).',
    }));
  }

  // Gitignore check
  const hasGitignore = fileSet.has('.gitignore');
  if (!hasGitignore && ctx.files.length > 5) {
    result.findings.push(makeFinding({
      ruleId: 'FK-DO-SETUP-001',
      title: 'No .gitignore file',
      categoryId: 'DO',
      severity: 'medium',
      confidence: 'high',
      labels: ['Unsafe', 'Incomplete'],
      summary: 'Project has no .gitignore — risk of committing sensitive files.',
      impact: 'node_modules, .env, and build artifacts may be committed.',
      location: { file: '.' },
      suggestedFix: 'Add a .gitignore appropriate for your stack.',
    }));
  }

  return result;
}
