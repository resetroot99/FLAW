import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeSmellFingerprint } from '../../../src/analyzers/smell-fingerprint.js';
import { resetFindingCounter } from '../../../src/analyzers/base.js';
import { makeContext } from '../../helpers/make-context.js';

beforeEach(() => {
  resetFindingCounter();
});

describe('analyzeSmellFingerprint', () => {
  describe('Cursor patterns: TODO implement stubs', () => {
    it('detects Cursor-style TODO implement stub', () => {
      const ctx = makeContext({
        'src/service.ts': [
          'export function processPayment() {',
          '  // TODO: implement payment processing',
          '  return null;',
          '}',
        ].join('\n'),
      });
      const result = analyzeSmellFingerprint(ctx);
      const cursorSmell = result.smellHits.find(s => s.id === 'CURSOR-STUB-001');
      expect(cursorSmell).toBeDefined();
      expect(cursorSmell!.count).toBeGreaterThanOrEqual(1);
    });

    it('detects TODO finish variant', () => {
      const ctx = makeContext({
        'src/auth.ts': [
          'export function verifyToken(token: string) {',
          '  // TODO finish token verification',
          '  return true;',
          '}',
        ].join('\n'),
      });
      const result = analyzeSmellFingerprint(ctx);
      const cursorSmell = result.smellHits.find(s => s.id === 'CURSOR-STUB-001');
      expect(cursorSmell).toBeDefined();
    });
  });

  describe('GPT patterns: hardcoded localhost', () => {
    it('detects hardcoded localhost values', () => {
      const ctx = makeContext({
        'src/config.ts': `const dbUrl = "mongodb://localhost:27017/mydb";`,
      });
      const result = analyzeSmellFingerprint(ctx);
      const gptSmell = result.smellHits.find(s => s.id === 'GPT-HARDCODE-001');
      expect(gptSmell).toBeDefined();
      expect(gptSmell!.count).toBeGreaterThanOrEqual(1);
    });

    it('detects hardcoded port assignment', () => {
      const ctx = makeContext({
        'src/server.ts': `const PORT = 3000;`,
      });
      const result = analyzeSmellFingerprint(ctx);
      const gptSmell = result.smellHits.find(s => s.id === 'GPT-HARDCODE-001');
      expect(gptSmell).toBeDefined();
    });
  });

  describe('Claude patterns: placeholder config values', () => {
    it('detects placeholder API URL', () => {
      const ctx = makeContext({
        'src/config.ts': `const API_URL = "https://api.example.com/v1";`,
      });
      const result = analyzeSmellFingerprint(ctx);
      const claudeSmell = result.smellHits.find(s => s.id === 'CLAUDE-FAKE-CONFIG-001');
      expect(claudeSmell).toBeDefined();
      expect(claudeSmell!.count).toBeGreaterThanOrEqual(1);
    });

    it('detects "your-x-here" placeholder', () => {
      const ctx = makeContext({
        'src/config.ts': `const SECRET = "your-secret-here";`,
      });
      const result = analyzeSmellFingerprint(ctx);
      const claudeSmell = result.smellHits.find(s => s.id === 'CLAUDE-FAKE-CONFIG-001');
      expect(claudeSmell).toBeDefined();
    });
  });

  describe('clean code returns no fingerprints', () => {
    it('returns no smell hits for clean code', () => {
      const ctx = makeContext({
        'src/utils.ts': [
          'export function add(a: number, b: number): number {',
          '  return a + b;',
          '}',
          '',
          'export function multiply(a: number, b: number): number {',
          '  return a * b;',
          '}',
        ].join('\n'),
      });
      const result = analyzeSmellFingerprint(ctx);
      // No tool-level aggregate smell hits should exist
      const toolSmells = result.smellHits.filter(s => s.id.startsWith('SMELL-'));
      expect(toolSmells).toHaveLength(0);
    });
  });
});
