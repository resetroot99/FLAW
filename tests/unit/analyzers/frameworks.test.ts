import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeFrameworks } from '../../../src/analyzers/frameworks.js';
import { resetFindingCounter } from '../../../src/analyzers/base.js';
import { makeContext } from '../../helpers/make-context.js';

beforeEach(() => {
  resetFindingCounter();
});

describe('analyzeFrameworks', () => {
  describe('Next.js: FK-NX-CLIENT-001 — client component importing server module', () => {
    it('detects client component importing server-only module', () => {
      const ctx = makeContext(
        {
          'src/components/Dashboard.tsx': [
            '"use client"',
            'import { PrismaClient } from "@prisma/client";',
            'export default function Dashboard() { return <div />; }',
          ].join('\n'),
        },
        {
          packageJson: {
            dependencies: { next: '14.0.0' },
          },
        },
      );
      const result = analyzeFrameworks(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-NX-CLIENT-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('critical');
    });

    it('passes when no server imports in client component', () => {
      const ctx = makeContext(
        {
          'src/components/Dashboard.tsx': [
            '"use client"',
            'import { useState } from "react";',
            'export default function Dashboard() { return <div />; }',
          ].join('\n'),
        },
        {
          packageJson: {
            dependencies: { next: '14.0.0' },
          },
        },
      );
      const result = analyzeFrameworks(ctx);
      const clientFindings = result.findings.filter(f => f.ruleId === 'FK-NX-CLIENT-001');
      expect(clientFindings).toHaveLength(0);
    });

    it('passes when file is not a client component', () => {
      const ctx = makeContext(
        {
          'src/components/Dashboard.tsx': [
            'import { PrismaClient } from "@prisma/client";',
            'export default function Dashboard() { return <div />; }',
          ].join('\n'),
        },
        {
          packageJson: {
            dependencies: { next: '14.0.0' },
          },
        },
      );
      const result = analyzeFrameworks(ctx);
      const clientFindings = result.findings.filter(f => f.ruleId === 'FK-NX-CLIENT-001');
      expect(clientFindings).toHaveLength(0);
    });
  });

  describe('FastAPI: FK-FA-CORS-001 — CORS wildcard', () => {
    it('detects CORS allow_origins=["*"]', () => {
      const ctx = makeContext({
        'main.py': [
          'from fastapi import FastAPI',
          'from fastapi.middleware.cors import CORSMiddleware',
          'app = FastAPI()',
          'app.add_middleware(',
          '    CORSMiddleware,',
          '    allow_origins=["*"],',
          '    allow_methods=["*"],',
          ')',
        ].join('\n'),
      });
      const result = analyzeFrameworks(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FA-CORS-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
    });

    it('passes when CORS has specific origins', () => {
      const ctx = makeContext({
        'main.py': [
          'from fastapi import FastAPI',
          'from fastapi.middleware.cors import CORSMiddleware',
          'app = FastAPI()',
          'app.add_middleware(',
          '    CORSMiddleware,',
          '    allow_origins=["https://example.com"],',
          ')',
        ].join('\n'),
      });
      const result = analyzeFrameworks(ctx);
      const corsFindings = result.findings.filter(f => f.ruleId === 'FK-FA-CORS-001');
      expect(corsFindings).toHaveLength(0);
    });
  });

  describe('FastAPI: FK-FA-RESPONSE-001 — missing response_model', () => {
    it('detects POST endpoint without response_model', () => {
      const ctx = makeContext({
        'routes/users.py': [
          'from fastapi import APIRouter',
          'router = APIRouter()',
          '@router.post("/users")',
          'def create_user(data: dict):',
          '    return {"id": 1}',
        ].join('\n'),
      });
      const result = analyzeFrameworks(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FA-RESPONSE-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('medium');
    });

    it('passes when response_model is specified', () => {
      const ctx = makeContext({
        'routes/users.py': [
          'from fastapi import APIRouter',
          'router = APIRouter()',
          '@router.post("/users", response_model=UserResponse)',
          'def create_user(data: dict):',
          '    return {"id": 1}',
        ].join('\n'),
      });
      const result = analyzeFrameworks(ctx);
      const respFindings = result.findings.filter(f => f.ruleId === 'FK-FA-RESPONSE-001');
      expect(respFindings).toHaveLength(0);
    });
  });

  describe('Express+Prisma: FK-EP-BODY-001 — req.body without validation', () => {
    it('detects req.body accessed without validation middleware', () => {
      const ctx = makeContext(
        {
          'src/routes/users.ts': [
            'import express from "express";',
            'const router = express.Router();',
            'router.post("/users", (req, res) => {',
            '  const name = req.body.name;',
            '  res.json({ name });',
            '});',
          ].join('\n'),
        },
        {
          packageJson: {
            dependencies: { express: '4.18.0' },
          },
        },
      );
      const result = analyzeFrameworks(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-EP-BODY-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('medium');
    });

    it('passes when zod validation is present', () => {
      const ctx = makeContext(
        {
          'src/routes/users.ts': [
            'import express from "express";',
            'import { z } from "zod";',
            'const schema = z.object({ name: z.string() });',
            'router.post("/users", (req, res) => {',
            '  const data = schema.parse(req.body);',
            '  res.json(data);',
            '});',
          ].join('\n'),
        },
        {
          packageJson: {
            dependencies: { express: '4.18.0' },
          },
        },
      );
      const result = analyzeFrameworks(ctx);
      const bodyFindings = result.findings.filter(f => f.ruleId === 'FK-EP-BODY-001');
      expect(bodyFindings).toHaveLength(0);
    });
  });

  describe('returns empty for no frameworks detected', () => {
    it('returns no findings for plain project', () => {
      const ctx = makeContext({
        'src/index.ts': 'console.log("hello");',
      });
      const result = analyzeFrameworks(ctx);
      expect(result.findings).toHaveLength(0);
    });
  });
});
