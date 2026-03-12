#!/usr/bin/env node

// parse-results.js — Parse FLAW JSON report and write outputs to GITHUB_OUTPUT
// No dependencies required. Called by the composite action.
//
// Usage: node parse-results.js <report-file> <threshold> <fail-on-critical>

import { readFileSync, appendFileSync } from 'fs';

const reportFile = process.argv[2];
const threshold = parseInt(process.argv[3] || '60', 10);
const failOnCritical = (process.argv[4] || 'true') === 'true';

const outputFile = process.env.GITHUB_OUTPUT;

if (!outputFile) {
  console.error('GITHUB_OUTPUT environment variable is not set');
  process.exit(1);
}

function setOutput(name, value) {
  // For multiline values, use the heredoc delimiter syntax
  if (typeof value === 'string' && value.includes('\n')) {
    appendFileSync(outputFile, `${name}<<FLAW_EOF\n${value}\nFLAW_EOF\n`);
  } else {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
}

// Read and parse the report
let report;
try {
  const raw = readFileSync(reportFile, 'utf-8').trim();
  report = JSON.parse(raw);
} catch (err) {
  console.error(`Failed to read or parse report file: ${reportFile}`);
  console.error(err.message);

  // Write fallback outputs so the action doesn't break
  setOutput('score', '0');
  setOutput('rating', 'unknown');
  setOutput('findings', '0');
  setOutput('status', 'FAIL');
  setOutput('critical_count', '0');
  setOutput('high_count', '0');
  setOutput('top_findings', '[]');
  setOutput('categories', '[]');
  process.exit(0);
}

const summary = report.summary || {};
const scores = report.scores || [];
const findings = report.findings || [];

const totalScore = summary.totalScore ?? 0;
const rating = summary.rating ?? 'unknown';
const criticalCount = summary.criticalCount ?? 0;
const highCount = summary.highCount ?? 0;
const totalFindings = findings.length;

// Determine pass/fail
const belowThreshold = totalScore < threshold;
const hasCritical = failOnCritical && criticalCount > 0;
const status = (belowThreshold || hasCritical) ? 'FAIL' : 'PASS';

// Top 5 critical/high findings
const topFindings = findings
  .filter(f => f.severity === 'critical' || f.severity === 'high')
  .slice(0, 5)
  .map(f => ({
    severity: f.severity,
    title: f.title,
    file: f.location?.file || '',
  }));

// Category breakdown
const categories = scores.map(s => ({
  name: s.categoryName,
  score: s.score,
  maxScore: s.maxScore,
  status: s.status,
}));

// Write all outputs
setOutput('score', String(totalScore));
setOutput('rating', rating);
setOutput('findings', String(totalFindings));
setOutput('status', status);
setOutput('critical_count', String(criticalCount));
setOutput('high_count', String(highCount));

// JSON outputs need to be single-line to work with ${{ }} expressions
setOutput('top_findings', JSON.stringify(topFindings));
setOutput('categories', JSON.stringify(categories));

console.log(`FLAW Audit Results:`);
console.log(`  Score:    ${totalScore}/100`);
console.log(`  Rating:   ${rating}`);
console.log(`  Status:   ${status}`);
console.log(`  Findings: ${totalFindings} (${criticalCount} critical, ${highCount} high)`);
