/**
 * Maps FLAW findings to real user-facing symptoms.
 * "This is why you're experiencing X..."
 */

import type { Finding } from '../types/index.js';

export interface Symptom {
  /** What the user actually sees / experiences */
  headline: string;
  /** Short icon label for the symptom */
  icon: string;
  /** Friendly explanation of the connection */
  explanation: string;
  /** The findings that cause this symptom */
  findings: Finding[];
}

interface SymptomRule {
  headline: string;
  icon: string;
  explanation: string;
  /** Match by rule ID prefix or exact ID */
  ruleIds: string[];
  /** Also match findings whose title/summary contains these keywords */
  keywords?: RegExp;
}

const symptomRules: SymptomRule[] = [
  {
    headline: 'Buttons or forms do nothing when clicked',
    icon: '[UI]',
    explanation: 'Some buttons and forms in your UI are missing event handlers — they look clickable but have no code attached to make them work.',
    ruleIds: ['FK-FW-BTN-001', 'FK-FW-FORM-001'],
  },
  {
    headline: 'Pages load but show blank or missing data',
    icon: '[DATA]',
    explanation: 'Your frontend is trying to read data that the backend isn\'t sending, or the field names don\'t match. The data exists but the UI can\'t find it.',
    ruleIds: ['FK-FW-WIRE-001', 'FK-FW-WIRE-002', 'FK-FW-WIRE-003', 'FK-BE-SHAPE-001', 'FK-BE-ENDPOINT-001'],
    keywords: /undefined|blank|empty|missing field|shape/i,
  },
  {
    headline: 'Changes don\'t save or data disappears after refresh',
    icon: '[SAVE]',
    explanation: 'Data is being stored in memory (variables/state) instead of being saved to the database. When the page refreshes or the server restarts, it\'s gone.',
    ruleIds: ['FK-BE-PERSIST-001', 'FK-FW-ASYNC-001'],
  },
  {
    headline: 'Features say "success" but nothing actually happened',
    icon: '[FAKE]',
    explanation: 'The app shows success messages before the server confirms the action worked. If the server fails silently, you think it worked but it didn\'t.',
    ruleIds: ['FK-FR-STATE-001', 'FK-EH-FALSESUCCESS-001'],
  },
  {
    headline: 'Things randomly break with no error message',
    icon: '[ERR]',
    explanation: 'Errors are being caught and silently swallowed — the code fails but nobody is told. This causes mysterious blank screens, missing data, and "it just stopped working" moments.',
    ruleIds: ['FK-EH-SILENT-001', 'FK-EH-SILENT-002'],
  },
  {
    headline: 'App crashes or shows error screens on certain actions',
    icon: '[CRASH]',
    explanation: 'There\'s no fallback when API calls or async operations fail. One network hiccup or server error crashes the whole page instead of showing a friendly message.',
    ruleIds: ['FK-EH-FALLBACK-001', 'FK-FR-STUB-001'],
  },
  {
    headline: 'Some features exist in the menu but don\'t work',
    icon: '[WIP]',
    explanation: 'There are routes, pages, or features that are registered in the app but the code behind them is empty, commented out, or never finished.',
    ruleIds: ['FK-BE-DEAD-001', 'FK-FR-CLAIM-001', 'FK-FR-MOCK-001', 'FK-BE-WIRE-001'],
    keywords: /stub|pass|commented.out|disabled|not.implemented|TODO|FIXME/i,
  },
  {
    headline: 'Users can see each other\'s private data',
    icon: '[LEAK]',
    explanation: 'Database queries are fetching ALL records instead of filtering by the current user. This means User A can potentially see User B\'s private information.',
    ruleIds: ['FK-DM-TENANT-001', 'FK-SA-AUTHZ-001'],
  },
  {
    headline: 'Anyone can access pages or APIs without logging in',
    icon: '[AUTH]',
    explanation: 'Some API endpoints don\'t check for a valid login session or token. Anyone who knows the URL can access them — no password needed.',
    ruleIds: ['FK-SA-AUTH-001'],
  },
  {
    headline: 'Sensitive data (passwords, keys) might be exposed',
    icon: '[SEC]',
    explanation: 'There are secrets, API keys, or passwords written directly in the source code or in files that could be accidentally shared.',
    ruleIds: ['FK-SA-SECRET-001'],
  },
  {
    headline: 'The app could be crashed by sending large or malicious input',
    icon: '[DOS]',
    explanation: 'Input fields accept unlimited data with no size checks. An attacker (or even a user pasting a huge block of text) could overwhelm the server.',
    ruleIds: ['FK-VB-UNBOUNDED-001', 'FK-VB-RAWDICT-001', 'FK-VB-SERVER-001', 'FK-SA-INPUT-001'],
  },
  {
    headline: 'Links or navigation go to pages that don\'t exist',
    icon: '[NAV]',
    explanation: 'Some links in the UI point to routes that were never created. Users click them and get a 404 or blank page.',
    ruleIds: ['FK-FW-NAV-001', 'FK-BE-ORPHAN-001'],
  },
  {
    headline: 'The codebase is getting harder to work with',
    icon: '[DEBT]',
    explanation: 'There are huge files, duplicated code, and dead code piling up. This makes every change harder and increases the chance of introducing new bugs.',
    ruleIds: ['FK-MH-SIZE-001', 'FK-MH-DEADCODE-001', 'FK-MH-DUPLICATION-001', 'FK-MH-ABSTRACTION-001'],
  },
  {
    headline: 'Hard to set up or deploy the project',
    icon: '[OPS]',
    explanation: 'Missing README, no environment variable documentation, or no CI/CD pipeline. New developers (or future you) will struggle to get this running.',
    ruleIds: ['FK-DO-SETUP-001', 'FK-DO-ENV-001', 'FK-DO-ENV-002', 'FK-DO-CI-001', 'FK-DO-LOGS-001'],
  },
  {
    headline: 'Components re-render too often or have memory leaks',
    icon: '[MEM]',
    explanation: 'useEffect hooks have wrong dependencies or missing cleanup functions. This causes infinite loops, stale data, and increasing memory usage over time.',
    ruleIds: ['FK-FW-EFFECT-001', 'FK-FW-EFFECT-002'],
  },
];

/**
 * Analyze findings and return the symptoms the user is likely experiencing.
 * Only returns symptoms that have at least one matching finding.
 */
export function diagnoseSymptoms(findings: Finding[]): Symptom[] {
  const openFindings = findings.filter(f => f.status === 'open');
  const symptoms: Symptom[] = [];

  for (const rule of symptomRules) {
    const matched: Finding[] = [];
    const seen = new Set<string>();

    for (const f of openFindings) {
      // Match by rule ID
      const byRule = rule.ruleIds.includes(f.ruleId);
      // Match by keyword in title/summary
      const byKeyword = rule.keywords ? (rule.keywords.test(f.title) || rule.keywords.test(f.summary)) : false;

      if (byRule || byKeyword) {
        // Deduplicate by ruleId+file
        const key = `${f.ruleId}:${f.location.file}`;
        if (!seen.has(key)) {
          seen.add(key);
          matched.push(f);
        }
      }
    }

    if (matched.length > 0) {
      symptoms.push({
        headline: rule.headline,
        icon: rule.icon,
        explanation: rule.explanation,
        findings: matched,
      });
    }
  }

  // Sort by number of findings (most impactful symptoms first)
  symptoms.sort((a, b) => b.findings.length - a.findings.length);

  return symptoms;
}
