import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeFrontendWiring } from '../../../src/analyzers/frontend-wiring.js';
import { resetFindingCounter } from '../../../src/analyzers/base.js';
import { makeContext } from '../../helpers/make-context.js';

beforeEach(() => {
  resetFindingCounter();
});

describe('analyzeFrontendWiring', () => {
  describe('FK-FW-BTN-001: buttons without handlers', () => {
    it('detects <button> with no onClick', () => {
      const ctx = makeContext({
        'src/components/Page.tsx': `<button className="btn">Click me</button>`,
      });
      const result = analyzeFrontendWiring(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FW-BTN-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
    });

    it('detects <Button> component without handler', () => {
      const ctx = makeContext({
        'src/components/Page.tsx': `<Button variant="primary">Save</Button>`,
      });
      const result = analyzeFrontendWiring(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FW-BTN-001');
      expect(finding).toBeDefined();
    });

    it('detects <IconButton> without handler', () => {
      const ctx = makeContext({
        'src/components/Page.tsx': `<IconButton aria-label="delete" />`,
      });
      const result = analyzeFrontendWiring(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FW-BTN-001');
      expect(finding).toBeDefined();
    });

    it('passes when button has onClick', () => {
      const ctx = makeContext({
        'src/components/Page.tsx': `<button onClick={handleClick}>Click me</button>`,
      });
      const result = analyzeFrontendWiring(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-FW-BTN-001')).toHaveLength(0);
    });

    it('passes when button is type=submit', () => {
      const ctx = makeContext({
        'src/components/Page.tsx': `<button type="submit">Save</button>`,
      });
      const result = analyzeFrontendWiring(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-FW-BTN-001')).toHaveLength(0);
    });

    it('passes when button is disabled', () => {
      const ctx = makeContext({
        'src/components/Page.tsx': `<button disabled>Click me</button>`,
      });
      const result = analyzeFrontendWiring(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-FW-BTN-001')).toHaveLength(0);
    });

    it('ignores non-UI files', () => {
      const ctx = makeContext({
        'src/utils/helper.ts': `<button>Click me</button>`,
      });
      const result = analyzeFrontendWiring(ctx);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe('FK-FW-FORM-001: forms without onSubmit', () => {
    it('detects <form> without onSubmit or action', () => {
      const ctx = makeContext({
        'src/components/Form.tsx': `<form className="my-form"><input /></form>`,
      });
      const result = analyzeFrontendWiring(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FW-FORM-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
    });

    it('passes when form has onSubmit', () => {
      const ctx = makeContext({
        'src/components/Form.tsx': `<form onSubmit={handleSubmit}><input /></form>`,
      });
      const result = analyzeFrontendWiring(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-FW-FORM-001')).toHaveLength(0);
    });

    it('passes when form has action', () => {
      const ctx = makeContext({
        'src/components/Form.tsx': `<form action="/api/submit"><input /></form>`,
      });
      const result = analyzeFrontendWiring(ctx);
      expect(result.findings.filter(f => f.ruleId === 'FK-FW-FORM-001')).toHaveLength(0);
    });
  });

  describe('FK-FW-STATE-001: dead handlers', () => {
    it('detects no-op onClick handler', () => {
      const ctx = makeContext({
        'src/components/Page.tsx': `<button onClick={() => console.log("clicked")}>Click</button>`,
      });
      const result = analyzeFrontendWiring(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FW-STATE-001');
      expect(finding).toBeDefined();
      expect(result.smellHits.some(s => s.id === 'SMELL-DEAD-HANDLER')).toBe(true);
    });

    it('detects void 0 handler', () => {
      const ctx = makeContext({
        'src/components/Page.tsx': `<button onClick={() => void 0}>Click</button>`,
      });
      const result = analyzeFrontendWiring(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FW-STATE-001');
      expect(finding).toBeDefined();
    });
  });

  describe('FK-FW-NAV-001: dead links', () => {
    it('detects href="#"', () => {
      const ctx = makeContext({
        'src/components/Nav.tsx': `<a href="#">Link</a>`,
      });
      const result = analyzeFrontendWiring(ctx);
      const finding = result.findings.find(f => f.ruleId === 'FK-FW-NAV-001');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('medium');
    });
  });
});
