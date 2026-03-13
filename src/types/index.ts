// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
// FAIL Kit v2 — Core Types

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Confidence = 'high' | 'medium' | 'low';
export type FindingStatus = 'open' | 'accepted-risk' | 'fixed' | 'suppressed';
export type DetectionMode = 'static' | 'runtime' | 'hybrid';
export type AuditType = 'launch-readiness' | 'code-integrity' | 'security-review' | 'quick-scan' | 'custom';
export type Rating = 'production-ready' | 'strong-but-needs-targeted-fixes' | 'functional-but-risky' | 'misleading-fragile' | 'cosmetic-not-trustworthy';
export type AuditStatus = 'pass' | 'conditional-pass' | 'fail';
export type SmellLevel = 'low' | 'moderate' | 'high' | 'severe';
export type CategoryStatus = 'pass' | 'warning' | 'fail';

export type Label =
  | 'Broken' | 'Misleading' | 'Fragile' | 'Incomplete' | 'Unsafe'
  | 'Unverified' | 'Overengineered' | 'Dead Control' | 'Fake Flow'
  | 'Auth Gap' | 'Schema Drift' | 'Mock Leakage' | 'Silent Failure'
  | 'Production-Blocking';

export interface Location {
  file: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
}

export interface Finding {
  id: string;
  title: string;
  ruleId: string;
  categoryId: string;
  severity: Severity;
  confidence: Confidence;
  status: FindingStatus;
  labels: Label[];
  summary: string;
  impact: string;
  location: Location;
  codeSnippet?: string;
  suggestedFix?: string;
  evidenceRefs?: string[];
}

export interface CategoryScore {
  categoryId: string;
  categoryName: string;
  score: number;
  maxScore: number;
  weight: number;
  status: CategoryStatus;
  notes?: string;
}

export interface SmellHit {
  id: string;
  label: string;
  count: number;
}

export interface SmellIndex {
  score: number;
  maxScore: number;
  level: SmellLevel;
  smells: SmellHit[];
}

export interface Gate {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'not-evaluated';
  reason?: string;
}

export interface FingerprintHit {
  tool: string;
  confidence: number;
  hits: number;
}

export interface AuditSummary {
  totalScore: number;
  maxScore: number;
  rating: Rating;
  status: AuditStatus;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  topRisks: string[];
  recommendation: string;
  launchBlockers: string[];
  fingerprint?: FingerprintHit[];
}

export interface AuditReport {
  schemaVersion: string;
  reportId: string;
  generatedAt: string;
  project: {
    name: string;
    path: string;
    branch?: string;
    commitSha?: string;
    framework?: string;
    runtime?: string;
    packageManager?: string;
  };
  audit: {
    type: AuditType;
    mode: DetectionMode;
    durationMs: number;
  };
  summary: AuditSummary;
  scores: CategoryScore[];
  smellIndex: SmellIndex;
  findings: Finding[];
  gates: Gate[];
}

// Rule definitions
export interface RuleSignal {
  pattern: string;
  description: string;
}

export interface Rule {
  id: string;
  title: string;
  categoryId: string;
  subcategoryId: string;
  defaultSeverity: Severity;
  labels: Label[];
  description: string;
  rationale: string;
  detection: {
    mode: DetectionMode[];
    signals: string[];
  };
}

export interface SmellDef {
  id: string;
  label: string;
  weight: number;
  description: string;
  signals: string[];
}

export interface CategoryDef {
  id: string;
  name: string;
  maxScore: number;
}

// Analyzer interface
export interface AnalyzerContext {
  root: string;
  files: string[];
  fileContents: Map<string, string>;
  packageJson?: Record<string, unknown>;
  framework?: string;
}

export interface AnalyzerResult {
  findings: Finding[];
  smellHits: SmellHit[];
}

// Triage
export interface TriageGroup {
  priority: 1 | 2 | 3;
  label: string;
  findings: Finding[];
  blastRadius: 'critical' | 'high' | 'moderate';
  rationale: string;
}

export interface TriageResult {
  groups: TriageGroup[];
  topThree: Finding[];
}

// Ignore rules
export interface IgnoreRule {
  type: 'ruleId' | 'findingId' | 'fileGlob' | 'ruleIdWithGlob';
  value: string;
  glob?: string;
  raw: string;
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'FR', name: 'Feature Reality & End-to-End Integrity', maxScore: 15 },
  { id: 'FW', name: 'Frontend Wiring & Interaction Integrity', maxScore: 12 },
  { id: 'BE', name: 'Backend / API Integrity', maxScore: 12 },
  { id: 'DM', name: 'Data Model & Persistence Integrity', maxScore: 10 },
  { id: 'VB', name: 'Validation & Business Rule Accuracy', maxScore: 8 },
  { id: 'EH', name: 'Error Handling & Failure Honesty', maxScore: 8 },
  { id: 'SA', name: 'Security, Auth, and Authorization', maxScore: 12 },
  { id: 'MH', name: 'Maintainability & Code Health', maxScore: 8 },
  { id: 'TV', name: 'Testing & Runtime Verification', maxScore: 8 },
  { id: 'DO', name: 'Deployment, Observability & Documentation', maxScore: 7 },
];
