/**
 * FLAW VS Code Analyzer — inline static analysis rules.
 * Mirrors the patterns from the FLAW CLI analyzers but operates on single files.
 */

export interface FlawFinding {
  ruleId: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  label: string;
  summary: string;
  suggestedFix: string;
  line: number;
  endLine?: number;
}

const TEST_FILE_RE = /(__tests__|__test__|\.test\.|\.spec\.|test_|_test\.|\btests\/|\btest\/)/i;

function isTestFile(path: string): boolean {
  return TEST_FILE_RE.test(path);
}

export function analyzeFile(filePath: string, content: string): FlawFinding[] {
  if (isTestFile(filePath)) return [];

  const findings: FlawFinding[] = [];
  const lines = content.split('\n');
  const isJs = /\.(ts|tsx|js|jsx)$/.test(filePath);
  const isPy = /\.py$/.test(filePath);
  const isUi = /\.(tsx|jsx|vue|svelte)$/.test(filePath);
  const isServer = /\b(api|server|route|action|controller|handler|middleware|mutation|views|endpoints)\b/i.test(filePath);

  // ── Error Handling ──

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // JS: Empty catch blocks
    if (isJs) {
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line) || (
        /catch\s*\([^)]*\)\s*\{/.test(line) && i + 1 < lines.length && /^\s*\}/.test(lines[i + 1])
      )) {
        findings.push({
          ruleId: 'FK-EH-SILENT-001',
          title: 'Empty catch block swallows error silently',
          severity: 'high',
          label: 'Silent Failure',
          summary: 'Empty catch block silently swallows errors. Failures go unnoticed.',
          suggestedFix: 'Log the error or surface it to the user.',
          line: i,
        });
      }

      // Catch with only console.log
      if (/catch\s*\(\w+\)\s*\{/.test(line)) {
        const body = lines.slice(i + 1, Math.min(i + 4, lines.length)).join('\n');
        if (/^\s*console\.(log|warn)\(/.test(body) && /^\s*\}/.test(lines[Math.min(i + 2, lines.length - 1)])) {
          findings.push({
            ruleId: 'FK-EH-SILENT-001',
            title: 'Catch block only logs to console',
            severity: 'medium',
            label: 'Silent Failure',
            summary: 'Catch logs the error but does not handle it. Users see no feedback.',
            suggestedFix: 'Surface the error to the user or upstream handler.',
            line: i,
          });
        }
      }
    }

    // Python: except: pass
    if (isPy && /^except\b/.test(trimmed)) {
      const isBroad = /^except\s*:|^except\s+Exception\b|^except\s+BaseException\b/.test(trimmed);
      const bodyLines: string[] = [];
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const bl = lines[j].trim();
        if (bl === '' || bl.startsWith('#')) continue;
        if (/^(except|else|finally|def |class |@)/.test(bl)) break;
        bodyLines.push(bl);
      }

      if (/:\s*pass\s*$/.test(trimmed) || (bodyLines.length === 1 && bodyLines[0] === 'pass')) {
        findings.push({
          ruleId: 'FK-EH-SILENT-002',
          title: isBroad ? 'Broad except swallows all errors with pass' : 'Exception swallowed with pass',
          severity: isBroad ? 'high' : 'medium',
          label: 'Silent Failure',
          summary: 'Exception caught and ignored. Bugs become impossible to trace.',
          suggestedFix: 'Log the exception or let it propagate.',
          line: i,
        });
      }

      if (isBroad && bodyLines.length === 1 && /^return\s+(None|\[\]|\{\}|""|0|False)$/.test(bodyLines[0])) {
        findings.push({
          ruleId: 'FK-EH-SILENT-002',
          title: 'Broad except returns default value — errors masked',
          severity: 'high',
          label: 'Silent Failure',
          summary: 'Catches all exceptions and returns a default. Caller gets empty data silently.',
          suggestedFix: 'Log the exception. Return an error response or let it propagate.',
          line: i,
        });
      }
    }

    // ── Frontend Wiring ──

    if (isUi) {
      // Buttons without handlers
      const buttonRegex = /<(?:button|Button|IconButton|Fab|LoadingButton|SubmitButton)\b[^>]*>/gi;
      const btnMatches = line.match(buttonRegex);
      if (btnMatches) {
        for (const btn of btnMatches) {
          const hasHandler = /on(Click|Submit|Press)|type\s*=\s*['"`]submit|handleClick|handleSubmit|to\s*=|href\s*=/i.test(btn);
          const isDisabled = /disabled/i.test(btn);
          if (!hasHandler && !isDisabled) {
            const region = lines.slice(i, Math.min(i + 5, lines.length)).join('\n');
            if (!/on(Click|Submit|Press)|handleClick|handleSubmit/i.test(region)) {
              findings.push({
                ruleId: 'FK-FW-BTN-001',
                title: 'Button has no effective handler',
                severity: 'high',
                label: 'Dead Control',
                summary: 'Button appears to lack an action handler. Users see a clickable button that does nothing.',
                suggestedFix: 'Bind onClick or make this a type="submit" button in a form.',
                line: i,
              });
            }
          }
        }
      }

      // Forms without onSubmit
      if (/<form[^>]*>/i.test(line) && !/on(Submit)|action\s*=/i.test(line)) {
        const region = lines.slice(i, Math.min(i + 5, lines.length)).join('\n');
        if (!/on(Submit)|action\s*=/i.test(region)) {
          findings.push({
            ruleId: 'FK-FW-FORM-001',
            title: 'Form has no submit handler',
            severity: 'high',
            label: 'Dead Control',
            summary: 'Form has no onSubmit or action. Cannot actually submit data.',
            suggestedFix: 'Bind onSubmit handler or set form action.',
            line: i,
          });
        }
      }

      // No-op handlers
      if (/(?:onClick|onSubmit|onChange|onPress)\s*=\s*\{?\s*\(\)\s*=>\s*(?:console\.log|void 0|null|undefined|\{\s*\})/i.test(line)) {
        findings.push({
          ruleId: 'FK-FW-STATE-001',
          title: 'Handler is a no-op or console.log only',
          severity: 'high',
          label: 'Dead Control',
          summary: 'Interactive control does nothing meaningful.',
          suggestedFix: 'Implement the real handler or remove the control.',
          line: i,
        });
      }

      // Dead links
      if (/href\s*=\s*['"`](#|javascript:void|['"`]\s*['"`])/i.test(line)) {
        findings.push({
          ruleId: 'FK-FW-NAV-001',
          title: 'Navigation link points nowhere',
          severity: 'medium',
          label: 'Dead Control',
          summary: 'Link has href="#" or empty — goes nowhere.',
          suggestedFix: 'Set a real destination or remove the link.',
          line: i,
        });
      }
    }

    // ── Feature Reality ──

    // Mock data in production paths
    if (/\b(mockData|fakeData|dummyData|sampleData|testData|placeholderData|placeholderItems|placeholderList)\b/i.test(line)) {
      findings.push({
        ruleId: 'FK-FR-MOCK-001',
        title: 'Mock data in production path',
        severity: 'critical',
        label: 'Mock Leakage',
        summary: 'Mock/fake data found in production code. Will be shown to real users.',
        suggestedFix: 'Remove mock data. Use real data sources.',
        line: i,
      });
    }

    // Hardcoded demo values
    if (/['"`](Lorem ipsum|John Doe|Jane Doe|test@test\.com|example@|foo@bar|123-456-7890|acme|sample company)['"`]/i.test(line)) {
      findings.push({
        ruleId: 'FK-FR-MOCK-001',
        title: 'Hardcoded demo/placeholder value',
        severity: 'medium',
        label: 'Mock Leakage',
        summary: 'Demo value visible to real users undermines credibility.',
        suggestedFix: 'Replace with real data sources.',
        line: i,
      });
    }

    // TODO/FIXME in critical paths
    if (isServer && /(?:\/\/|#)\s*(TODO|FIXME|HACK|TEMP|XXX|PLACEHOLDER)\b/i.test(line)) {
      findings.push({
        ruleId: 'FK-FR-CLAIM-001',
        title: 'TODO/FIXME in critical path',
        severity: 'high',
        label: 'Incomplete',
        summary: 'Incomplete logic in a critical code path.',
        suggestedFix: 'Complete the implementation.',
        line: i,
      });
    }

    // ── Security ──

    // Hardcoded secrets
    const secretPatterns = [
      { re: /(?:api[_-]?key|apikey)\s*[:=]\s*['"`][A-Za-z0-9_\-]{20,}['"`]/i, label: 'API key' },
      { re: /(?:secret|token|password|passwd|pwd)\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/i, label: 'Secret/token' },
      { re: /sk[_-](?:live|test)[_-][A-Za-z0-9]{20,}/i, label: 'Stripe key' },
      { re: /ghp_[A-Za-z0-9]{36}/i, label: 'GitHub PAT' },
      { re: /AKIA[A-Z0-9]{16}/i, label: 'AWS access key' },
      { re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i, label: 'Private key' },
    ];

    for (const { re, label: secretLabel } of secretPatterns) {
      if (re.test(line)) {
        if (/your[_-]|xxx|placeholder|example|dummy|process\.env|import\.meta\.env|os\.environ/i.test(line)) continue;
        findings.push({
          ruleId: 'FK-SA-SECRET-001',
          title: `Potential ${secretLabel} exposed in source`,
          severity: 'critical',
          label: 'Unsafe',
          summary: `Possible ${secretLabel} in source code. Exposed secrets enable unauthorized access.`,
          suggestedFix: 'Rotate the secret, remove from source, use environment variables.',
          line: i,
        });
      }
    }

    // XSS
    if (isUi && /dangerouslySetInnerHTML|v-html\s*=|\.innerHTML\s*=/.test(line)) {
      if (!/\/.*innerHTML.*\/|['"`].*innerHTML.*['"`]/.test(line)) {
        findings.push({
          ruleId: 'FK-SA-INPUT-001',
          title: 'Unescaped HTML injection risk',
          severity: 'medium',
          label: 'Unsafe',
          summary: 'Raw HTML rendering. XSS risk if user-controlled content.',
          suggestedFix: 'Sanitize content before rendering.',
          line: i,
        });
      }
    }

    // ── Python stubs ──
    if (isPy && /^\s*(async\s+)?def\s+\w+/.test(line)) {
      const funcName = line.match(/def\s+(\w+)/)?.[1] || '';
      if (/^(__\w+__|test_|_test$)/.test(funcName)) continue;

      const bodyLines: string[] = [];
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const bl = lines[j].trim();
        if (bl === '' || bl.startsWith('#') || bl.startsWith('"""') || bl.startsWith("'''")) continue;
        if (/^(def |class |@)/.test(bl)) break;
        bodyLines.push(bl);
        if (bodyLines.length >= 2) break;
      }

      if (bodyLines.length === 1 && bodyLines[0] === 'pass') {
        findings.push({
          ruleId: 'FK-FR-STUB-001',
          title: `Function "${funcName}" is a stub (pass)`,
          severity: 'high',
          label: 'Incomplete',
          summary: `"${funcName}" body is just "pass". Feature is not implemented.`,
          suggestedFix: `Implement "${funcName}" or remove it.`,
          line: i,
        });
      }

      if (bodyLines.length === 1 && /raise\s+NotImplementedError/.test(bodyLines[0])) {
        findings.push({
          ruleId: 'FK-FR-STUB-001',
          title: `Function "${funcName}" raises NotImplementedError`,
          severity: 'high',
          label: 'Incomplete',
          summary: `"${funcName}" only raises NotImplementedError. Will crash at runtime.`,
          suggestedFix: `Implement "${funcName}" or remove it.`,
          line: i,
        });
      }
    }
  }

  // ── File-level checks ──

  // Large file
  if (lines.length > 500) {
    findings.push({
      ruleId: 'FK-MH-SIZE-001',
      title: `Large file (${lines.length} lines)`,
      severity: lines.length > 1000 ? 'high' : 'medium',
      label: 'Overengineered',
      summary: `File has ${lines.length} lines. Hard to maintain and review.`,
      suggestedFix: 'Break into smaller, focused modules.',
      line: 0,
    });
  }

  // Commented-out code
  if (isJs) {
    const commentedLines = lines.filter(l => /^\s*\/\/\s*(const|let|var|function|if|for|while|return|import|export|class)\b/.test(l));
    if (commentedLines.length > 10) {
      findings.push({
        ruleId: 'FK-MH-DEADCODE-001',
        title: `${commentedLines.length} lines of commented-out code`,
        severity: 'medium',
        label: 'Dead Control',
        summary: 'Large amounts of commented-out code. Clutters the file.',
        suggestedFix: 'Delete commented code. Use version control for history.',
        line: 0,
      });
    }
  }

  return findings;
}
