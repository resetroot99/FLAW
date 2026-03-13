// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
// FLAW — Telemetry Type Definitions

export interface TelemetryConfig {
  enabled: boolean;
  id: string;
  consentedAt: string;
}

export interface TelemetryEvent {
  v: string;
  id: string;
  ts: string;
  score: number;
  rating: string;
  findings: string[];
  categories: Record<string, number>;
  framework: string;
  fileCount: number;
  smellIndex: number;
  fingerprint: string[];
  gatesPassed: number;
  gatesFailed: number;
}

export interface AggregateReport {
  totalReports: number;
  topFindings: Array<{ ruleId: string; count: number }>;
  averageScoreByFramework: Record<string, { avg: number; count: number }>;
  commonFingerprints: Array<{ tool: string; count: number }>;
  scoreDistribution: Record<string, number>;
}
