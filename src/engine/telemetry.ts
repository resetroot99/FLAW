// FLAW — Opt-in Anonymous Telemetry

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { AuditReport } from '../types/index.js';
import type { TelemetryConfig, TelemetryEvent, AggregateReport } from './telemetry-types.js';

const TELEMETRY_DIR = join(homedir(), '.flaw');
const TELEMETRY_FILE = join(TELEMETRY_DIR, 'telemetry.json');
const TELEMETRY_ENDPOINT = 'https://telemetry.fail-kit.dev/v1/report';

export function getTelemetryConfig(): { enabled: boolean; id: string } {
  try {
    if (!existsSync(TELEMETRY_FILE)) {
      return { enabled: false, id: '' };
    }
    const raw = readFileSync(TELEMETRY_FILE, 'utf-8');
    const config: TelemetryConfig = JSON.parse(raw);
    return { enabled: !!config.enabled, id: config.id || '' };
  } catch {
    return { enabled: false, id: '' };
  }
}

export function telemetryConfigExists(): boolean {
  return existsSync(TELEMETRY_FILE);
}

export function saveTelemetryChoice(enabled: boolean): void {
  try {
    if (!existsSync(TELEMETRY_DIR)) {
      mkdirSync(TELEMETRY_DIR, { recursive: true });
    }

    let id: string;
    // Preserve existing ID if config already exists
    if (existsSync(TELEMETRY_FILE)) {
      try {
        const existing: TelemetryConfig = JSON.parse(readFileSync(TELEMETRY_FILE, 'utf-8'));
        id = existing.id || randomUUID();
      } catch {
        id = randomUUID();
      }
    } else {
      id = randomUUID();
    }

    const config: TelemetryConfig = {
      enabled,
      id,
      consentedAt: new Date().toISOString(),
    };

    writeFileSync(TELEMETRY_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  } catch {
    // Silently fail — telemetry config is non-critical
  }
}

export async function promptTelemetryConsent(): Promise<boolean> {
  // If stdin is not a TTY (CI, piped input), default to disabled silently
  if (!process.stdin.isTTY) {
    saveTelemetryChoice(false);
    return false;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    console.log(`
  Help improve FLAW by sharing anonymous pattern data? (y/n)

  What we send: finding rule IDs, category scores, framework detected, file count.
  What we NEVER send: code, file paths, project names, or any identifying info.

  You can change this anytime with: flaw --telemetry-off / --telemetry-on
`);

    rl.question('  > ', (answer) => {
      rl.close();
      const enabled = answer.trim().toLowerCase().startsWith('y');
      saveTelemetryChoice(enabled);
      if (enabled) {
        console.log('  Telemetry enabled. Thank you!\n');
      } else {
        console.log('  Telemetry disabled. No data will be sent.\n');
      }
      resolve(enabled);
    });
  });
}

function buildTelemetryEvent(report: AuditReport, configId: string): TelemetryEvent {
  // Extract only rule IDs — no paths, no code, no project names
  const findingRuleIds = [...new Set(report.findings.map(f => f.ruleId))];

  // Build category score map — only category IDs and numeric scores
  const categories: Record<string, number> = {};
  for (const cat of report.scores) {
    categories[cat.categoryId] = cat.score;
  }

  // Extract fingerprint tool names only
  const fingerprint = (report.summary.fingerprint || []).map(fp => fp.tool);

  const gatesPassed = report.gates.filter(g => g.status === 'pass').length;
  const gatesFailed = report.gates.filter(g => g.status === 'fail').length;

  return {
    v: '1.0.0',
    id: configId,
    ts: new Date().toISOString(),
    score: report.summary.totalScore,
    rating: report.summary.rating,
    findings: findingRuleIds,
    categories,
    framework: report.project.framework || 'unknown',
    fileCount: report.findings.length > 0
      ? new Set(report.findings.map(f => f.location.file)).size
      : 0,
    smellIndex: report.smellIndex.score,
    fingerprint,
    gatesPassed,
    gatesFailed,
  };
}

export function sendTelemetry(report: AuditReport): void {
  // Fire-and-forget — must NEVER block or crash the tool
  try {
    const config = getTelemetryConfig();
    if (!config.enabled || !config.id) return;

    const event = buildTelemetryEvent(report, config.id);
    const body = JSON.stringify(event);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    })
      .then(() => clearTimeout(timeout))
      .catch(() => clearTimeout(timeout));
  } catch {
    // Silently swallow all errors
  }
}

export function generateAggregateReport(events: TelemetryEvent[]): AggregateReport {
  // Count finding rule IDs across all events
  const findingCounts = new Map<string, number>();
  for (const event of events) {
    for (const ruleId of event.findings) {
      findingCounts.set(ruleId, (findingCounts.get(ruleId) || 0) + 1);
    }
  }

  const topFindings = Array.from(findingCounts.entries())
    .map(([ruleId, count]) => ({ ruleId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Average score by framework
  const frameworkAccum = new Map<string, { total: number; count: number }>();
  for (const event of events) {
    const fw = event.framework || 'unknown';
    const existing = frameworkAccum.get(fw);
    if (existing) {
      existing.total += event.score;
      existing.count += 1;
    } else {
      frameworkAccum.set(fw, { total: event.score, count: 1 });
    }
  }

  const averageScoreByFramework: Record<string, { avg: number; count: number }> = {};
  for (const [fw, data] of frameworkAccum) {
    averageScoreByFramework[fw] = {
      avg: Math.round((data.total / data.count) * 10) / 10,
      count: data.count,
    };
  }

  // Common fingerprints
  const fpCounts = new Map<string, number>();
  for (const event of events) {
    for (const tool of event.fingerprint) {
      fpCounts.set(tool, (fpCounts.get(tool) || 0) + 1);
    }
  }

  const commonFingerprints = Array.from(fpCounts.entries())
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count);

  // Score distribution histogram (buckets of 10)
  const scoreDistribution: Record<string, number> = {
    '0-9': 0,
    '10-19': 0,
    '20-29': 0,
    '30-39': 0,
    '40-49': 0,
    '50-59': 0,
    '60-69': 0,
    '70-79': 0,
    '80-89': 0,
    '90-100': 0,
  };

  for (const event of events) {
    const score = Math.max(0, Math.min(100, event.score));
    if (score >= 90) scoreDistribution['90-100']++;
    else {
      const bucket = Math.floor(score / 10);
      const key = `${bucket * 10}-${bucket * 10 + 9}`;
      if (key in scoreDistribution) scoreDistribution[key]++;
    }
  }

  return {
    totalReports: events.length,
    topFindings,
    averageScoreByFramework,
    commonFingerprints,
    scoreDistribution,
  };
}
