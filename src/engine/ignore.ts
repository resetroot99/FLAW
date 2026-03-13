// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
// .flaw-ignore support — suppress known issues
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, IgnoreRule } from '../types/index.js';

export function loadIgnoreRules(root: string): IgnoreRule[] {
  const ignorePath = join(root, '.flaw-ignore');
  if (!existsSync(ignorePath)) return [];

  const content = readFileSync(ignorePath, 'utf-8');
  const rules: IgnoreRule[] = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // FK-XX-YYY-NNN:glob/pattern — rule ID with file glob
    const ruleGlobMatch = line.match(/^(FK-\w+-\w+-\d+):(.+)$/);
    if (ruleGlobMatch) {
      rules.push({ type: 'ruleIdWithGlob', value: ruleGlobMatch[1], glob: ruleGlobMatch[2], raw: line });
      continue;
    }

    // FK-XX-YYY-NNN — plain rule ID
    if (/^FK-\w+-\w+-\d+$/.test(line)) {
      rules.push({ type: 'ruleId', value: line, raw: line });
      continue;
    }

    // finding_NNN — finding ID
    if (/^finding_\d+$/.test(line)) {
      rules.push({ type: 'findingId', value: line, raw: line });
      continue;
    }

    // Anything else is a file glob pattern
    rules.push({ type: 'fileGlob', value: line, raw: line });
  }

  return rules;
}

function matchGlob(filePath: string, pattern: string): boolean {
  // Simple glob matching — supports * and ** patterns
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*');
  return new RegExp(`(^|/)${regex}($|/)`).test(filePath);
}

export function applyIgnoreRules(findings: Finding[], rules: IgnoreRule[]): { filtered: Finding[]; suppressedCount: number } {
  if (rules.length === 0) return { filtered: findings, suppressedCount: 0 };

  let suppressedCount = 0;

  const filtered = findings.map(f => {
    for (const rule of rules) {
      let matches = false;

      switch (rule.type) {
        case 'ruleId':
          matches = f.ruleId === rule.value;
          break;
        case 'findingId':
          matches = f.id === rule.value;
          break;
        case 'fileGlob':
          matches = matchGlob(f.location.file, rule.value);
          break;
        case 'ruleIdWithGlob':
          matches = f.ruleId === rule.value && matchGlob(f.location.file, rule.glob!);
          break;
      }

      if (matches) {
        suppressedCount++;
        return { ...f, status: 'suppressed' as const };
      }
    }
    return f;
  });

  return { filtered, suppressedCount };
}
