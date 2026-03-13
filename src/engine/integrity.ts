// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_STRINGS = ['resetroot99', 'ajakvani', 'BSL'];

/**
 * Verifies the LICENSE.txt file has not been stripped or replaced.
 * Prints a warning to stderr if tampering is detected.
 */
export function checkIntegrity(): void {
  try {
    // Walk up from dist/ or src/ to find project root
    const self = typeof __filename !== 'undefined'
      ? __filename
      : fileURLToPath(import.meta.url);
    let dir = dirname(self);
    let licensePath = '';
    for (let i = 0; i < 5; i++) {
      const candidate = resolve(dir, 'LICENSE.txt');
      if (existsSync(candidate)) {
        licensePath = candidate;
        break;
      }
      dir = resolve(dir, '..');
    }

    if (!licensePath) {
      printTamperWarning('LICENSE.txt is missing');
      return;
    }

    const content = readFileSync(licensePath, 'utf-8');
    for (const token of REQUIRED_STRINGS) {
      if (!content.includes(token)) {
        printTamperWarning(`LICENSE.txt has been modified (missing: ${token})`);
        return;
      }
    }
  } catch {
    // Don't crash — just warn
    printTamperWarning('Could not verify license integrity');
  }
}

function printTamperWarning(reason: string): void {
  const msg = [
    '',
    '\x1b[33m⚠  License integrity check failed\x1b[0m',
    `   ${reason}`,
    '   FLAW is © 2026 resetroot99 & ajakvani, licensed under BSL 1.1.',
    '   https://github.com/resetroot99/FLAW',
    '',
  ].join('\n');
  console.error(msg);
}
