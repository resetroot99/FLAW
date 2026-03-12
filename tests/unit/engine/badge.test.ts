import { describe, it, expect } from 'vitest';
import { generateBadge } from '../../../src/engine/badge.js';

describe('generateBadge', () => {
  it('returns a valid SVG string', () => {
    const svg = generateBadge(85, 'production-ready');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('contains the score text', () => {
    const svg = generateBadge(72, 'functional-but-risky');
    expect(svg).toContain('72/100');
  });

  it('contains the rating text', () => {
    const svg = generateBadge(72, 'functional-but-risky');
    expect(svg).toContain('functional-but-risky');
  });

  it('contains the FLAW label', () => {
    const svg = generateBadge(50, 'misleading-fragile');
    expect(svg).toContain('FLAW');
  });

  it('uses green color for score >= 80', () => {
    const svg = generateBadge(90, 'production-ready');
    expect(svg).toContain('#4c1');
  });

  it('uses yellow color for score >= 60 and < 80', () => {
    const svg = generateBadge(65, 'functional-but-risky');
    expect(svg).toContain('#dfb317');
  });

  it('uses orange color for score >= 40 and < 60', () => {
    const svg = generateBadge(45, 'misleading-fragile');
    expect(svg).toContain('#fe7d37');
  });

  it('uses red color for score < 40', () => {
    const svg = generateBadge(25, 'cosmetic-not-trustworthy');
    expect(svg).toContain('#e05d44');
  });

  it('includes title element with score and rating', () => {
    const svg = generateBadge(80, 'strong-but-needs-targeted-fixes');
    expect(svg).toContain('<title>FLAW Score: 80/100');
    expect(svg).toContain('strong-but-needs-targeted-fixes</title>');
  });

  it('boundary: score of exactly 80 is green', () => {
    const svg = generateBadge(80, 'strong-but-needs-targeted-fixes');
    expect(svg).toContain('#4c1');
  });

  it('boundary: score of exactly 40 is orange', () => {
    const svg = generateBadge(40, 'misleading-fragile');
    expect(svg).toContain('#fe7d37');
  });

  it('boundary: score of exactly 60 is yellow', () => {
    const svg = generateBadge(60, 'functional-but-risky');
    expect(svg).toContain('#dfb317');
  });
});
