import type { AnalyzerContext, AnalyzerResult, Finding, SmellHit, Severity, Confidence, Label, Location } from '../types/index.js';

let findingCounter = 0;

export function makeFinding(opts: {
  ruleId: string;
  title: string;
  categoryId: string;
  severity: Severity;
  confidence: Confidence;
  labels: Label[];
  summary: string;
  impact: string;
  location: Location;
  codeSnippet?: string;
  suggestedFix?: string;
  evidenceRefs?: string[];
}): Finding {
  findingCounter++;
  return {
    id: `finding_${String(findingCounter).padStart(3, '0')}`,
    status: 'open',
    ...opts,
  };
}

export function makeSmell(id: string, label: string, count: number): SmellHit {
  return { id, label, count };
}

export function emptyResult(): AnalyzerResult {
  return { findings: [], smellHits: [] };
}

export function mergeResults(...results: AnalyzerResult[]): AnalyzerResult {
  return {
    findings: results.flatMap(r => r.findings),
    smellHits: results.flatMap(r => r.smellHits),
  };
}

export function resetFindingCounter(): void {
  findingCounter = 0;
}

export type Analyzer = (ctx: AnalyzerContext) => AnalyzerResult;
