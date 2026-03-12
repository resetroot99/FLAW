import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeSecurityAuth } from '../../../src/analyzers/security-auth.js';
import { resetFindingCounter } from '../../../src/analyzers/base.js';
import { makeContext } from '../../helpers/make-context.js';

beforeEach(() => {
  resetFindingCounter();
});

describe('analyzeSecurityAuth', () => {
  describe('FK-SA-SECRET-001: hardcoded secrets', () => {
    it('detects hardcoded API key', () => {
      const ctx = makeContext({
        'src/config.ts': `const apiKey = "aK7bC9dE2fG4hI6jL8mN0pQ3rS5t";`,
      });
      const result = analyzeSecurityAuth(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-SA-SECRET-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('critical');
    });

    it('detects secret token pattern', () => {
      const ctx = makeContext({
        'src/payment.ts': `const secret = "realtoken_Aq7B9cD2eF4gH6iJ";`,
      });
      const result = analyzeSecurityAuth(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-SA-SECRET-001');
      expect(finding).toBeDefined();
    });

    it('detects GitHub PAT', () => {
      const ctx = makeContext({
        'src/git.ts': `const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";`,
      });
      const result = analyzeSecurityAuth(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-SA-SECRET-001');
      expect(finding).toBeDefined();
    });

    it('detects AWS access key', () => {
      const ctx = makeContext({
        'src/aws.ts': `const accessKey = "AKIAIOSFODNN7REALKEY1";`,
      });
      const result = analyzeSecurityAuth(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-SA-SECRET-001');
      expect(finding).toBeDefined();
    });

    it('detects private key', () => {
      const ctx = makeContext({
        'src/cert.ts': `const key = "-----BEGIN RSA PRIVATE KEY-----";`,
      });
      const result = analyzeSecurityAuth(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-SA-SECRET-001');
      expect(finding).toBeDefined();
    });

    it('skips placeholder values', () => {
      const ctx = makeContext({
        'src/config.ts': `const apiKey = process.env.API_KEY;`,
      });
      const result = analyzeSecurityAuth(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-SA-SECRET-001')).toHaveLength(0);
    });

    it('skips test files', () => {
      const ctx = makeContext({
        'src/config.test.ts': `const secret = "sk_test_ABCDEFGHIJKLMNOPQRSTUVWXYZa";`,
      });
      const result = analyzeSecurityAuth(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-SA-SECRET-001')).toHaveLength(0);
    });
  });

  describe('FK-SA-AUTH-001: routes without auth', () => {
    it('detects Express route without auth', () => {
      const ctx = makeContext({
        'src/api/users/route.ts': [
          'import express from "express";',
          'const router = express.Router();',
          'router.get("/users", (req, res) => {',
          '  res.json({ users: [] });',
          '});',
        ].join('\n'),
      });
      const result = analyzeSecurityAuth(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-SA-AUTH-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
    });

    it('passes when auth checks exist', () => {
      const ctx = makeContext({
        'src/api/users/route.ts': [
          'import { getSession } from "next-auth";',
          'router.get("/users", async (req, res) => {',
          '  const session = await getSession(req);',
          '  res.json({ users: [] });',
          '});',
        ].join('\n'),
      });
      const result = analyzeSecurityAuth(ctx);
      const authFindings = result.findings.filter(f => f.ruleId === 'FK-SA-AUTH-001');
      expect(authFindings).toHaveLength(0);
    });

    it('passes for public paths like login', () => {
      const ctx = makeContext({
        'src/api/login.ts': [
          'router.post("/login", (req, res) => {',
          '  res.json({ token: "abc" });',
          '});',
        ].join('\n'),
      });
      const result = analyzeSecurityAuth(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-SA-AUTH-001')).toHaveLength(0);
    });

    it('detects FastAPI route without auth', () => {
      const ctx = makeContext({
        'src/api/endpoints.py': [
          'from fastapi import APIRouter',
          'router = APIRouter()',
          '@router.get("/items")',
          'def get_items():',
          '    return []',
        ].join('\n'),
      });
      const result = analyzeSecurityAuth(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-SA-AUTH-001');
      expect(finding).toBeDefined();
    });

    it('passes for FastAPI with Depends auth', () => {
      const ctx = makeContext({
        'src/api/endpoints.py': [
          'from fastapi import APIRouter, Depends',
          'from auth import get_current_user',
          'router = APIRouter()',
          '@router.get("/items")',
          'def get_items(user = Depends(get_current_user)):',
          '    return []',
        ].join('\n'),
      });
      const result = analyzeSecurityAuth(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-SA-AUTH-001')).toHaveLength(0);
    });
  });

  describe('XSS patterns', () => {
    it('detects dangerouslySetInnerHTML', () => {
      const ctx = makeContext({
        'src/components/Render.tsx': `<div dangerouslySetInnerHTML={{ __html: userContent }} />`,
      });
      const result = analyzeSecurityAuth(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-SA-INPUT-001');
      expect(finding).toBeDefined();
    });

    it('detects innerHTML assignment', () => {
      const ctx = makeContext({
        'src/components/Render.jsx': `element.innerHTML = userContent;`,
      });
      const result = analyzeSecurityAuth(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-SA-INPUT-001');
      expect(finding).toBeDefined();
    });
  });
});
