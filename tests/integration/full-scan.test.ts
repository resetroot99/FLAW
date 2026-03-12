import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scan } from '../../src/engine/scanner.js';
import { computeCategoryScores, computeSmellIndex, computeGates, computeSummary } from '../../src/engine/scorer.js';

describe('full scan integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'flaw-test-'));
  });

  it('scans a project with issues and produces findings', async () => {
    // Create a mini project with known issues
    mkdirSync(join(tmpDir, 'src', 'api'), { recursive: true });
    mkdirSync(join(tmpDir, 'src', 'components'), { recursive: true });

    // Empty catch block
    writeFileSync(join(tmpDir, 'src', 'api', 'handler.ts'), [
      'export function POST(req) {',
      '  try {',
      '    doSomething();',
      '  } catch (e) {}',
      '  return Response.json({ ok: true });',
      '}',
    ].join('\n'));

    // Button without handler
    writeFileSync(join(tmpDir, 'src', 'components', 'Page.tsx'), [
      'export function Page() {',
      '  return <button className="btn">Click</button>;',
      '}',
    ].join('\n'));

    // Mock data
    writeFileSync(join(tmpDir, 'src', 'components', 'Dashboard.tsx'), [
      'const items = mockData.items;',
      'export function Dashboard() {',
      '  return <div>{items.length}</div>;',
      '}',
    ].join('\n'));

    const result = await scan(tmpDir);

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.ctx.files.length).toBeGreaterThan(0);

    // Verify scoring pipeline works end-to-end
    const scores = computeCategoryScores(result.findings);
    expect(scores).toHaveLength(10);

    const smellIndex = computeSmellIndex(result.smellHits);
    expect(smellIndex.maxScore).toBe(10);

    const gates = computeGates(result.findings);
    expect(gates).toHaveLength(6);

    const summary = computeSummary(scores, result.findings, smellIndex, gates);
    expect(summary.totalScore).toBeLessThanOrEqual(100);
    expect(summary.totalScore).toBeGreaterThanOrEqual(0);
    expect(['pass', 'conditional-pass', 'fail']).toContain(summary.status);
  });

  it('handles empty project gracefully', async () => {
    const result = await scan(tmpDir);
    expect(result.findings).toHaveLength(0);
    expect(result.smellHits).toHaveLength(0);
  });

  it('produces correct category scores for clean project', async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'index.ts'), [
      'export function main() {',
      '  console.log("Hello");',
      '}',
    ].join('\n'));

    const result = await scan(tmpDir);
    const scores = computeCategoryScores(result.findings);
    const total = Math.round(scores.reduce((sum, s) => sum + s.score, 0));
    // A clean project should score near 100
    expect(total).toBeGreaterThanOrEqual(90);
  });
});
