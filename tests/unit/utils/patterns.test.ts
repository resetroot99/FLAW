import { describe, it, expect } from 'vitest';
import { searchFiles, countPattern, filesMatching, extractSnippet } from '../../../src/utils/patterns.js';

describe('searchFiles', () => {
  it('finds pattern matches across multiple files', () => {
    const contents = new Map([
      ['a.ts', 'const foo = 1;\nconst bar = 2;'],
      ['b.ts', 'let foo = 3;'],
    ]);
    const results = searchFiles(contents, /foo/);
    expect(results).toHaveLength(2);
    expect(results[0].file).toBe('a.ts');
    expect(results[0].line).toBe(1);
    expect(results[0].match).toBe('foo');
    expect(results[0].context).toBe('const foo = 1;');
  });

  it('returns empty array when no matches', () => {
    const contents = new Map([['a.ts', 'hello world']]);
    const results = searchFiles(contents, /notfound/);
    expect(results).toHaveLength(0);
  });

  it('respects file filter', () => {
    const contents = new Map([
      ['a.ts', 'const foo = 1;'],
      ['b.py', 'foo = 1'],
    ]);
    const results = searchFiles(contents, /foo/, f => f.endsWith('.ts'));
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe('a.ts');
  });

  it('reports correct line numbers (1-based)', () => {
    const contents = new Map([
      ['a.ts', 'line1\nline2\ntarget here\nline4'],
    ]);
    const results = searchFiles(contents, /target/);
    expect(results[0].line).toBe(3);
  });
});

describe('countPattern', () => {
  it('counts all occurrences globally across files', () => {
    const contents = new Map([
      ['a.ts', 'foo foo foo'],
      ['b.ts', 'foo bar'],
    ]);
    const count = countPattern(contents, /foo/);
    expect(count).toBe(4);
  });

  it('returns 0 when no matches', () => {
    const contents = new Map([['a.ts', 'hello']]);
    expect(countPattern(contents, /notfound/)).toBe(0);
  });

  it('respects file filter', () => {
    const contents = new Map([
      ['a.ts', 'foo'],
      ['b.py', 'foo foo'],
    ]);
    const count = countPattern(contents, /foo/, f => f.endsWith('.ts'));
    expect(count).toBe(1);
  });

  it('preserves case insensitive flag', () => {
    const contents = new Map([['a.ts', 'Foo FOO foo']]);
    const count = countPattern(contents, /foo/i);
    expect(count).toBe(3);
  });
});

describe('filesMatching', () => {
  it('returns files whose content matches pattern', () => {
    const contents = new Map([
      ['a.ts', 'import React from "react"'],
      ['b.ts', 'const x = 1'],
      ['c.ts', 'import React from "react"'],
    ]);
    const matches = filesMatching(contents, /import React/);
    expect(matches).toEqual(['a.ts', 'c.ts']);
  });

  it('returns empty array when no files match', () => {
    const contents = new Map([['a.ts', 'hello']]);
    expect(filesMatching(contents, /notfound/)).toEqual([]);
  });

  it('respects file filter', () => {
    const contents = new Map([
      ['a.ts', 'target'],
      ['b.py', 'target'],
    ]);
    const matches = filesMatching(contents, /target/, f => f.endsWith('.py'));
    expect(matches).toEqual(['b.py']);
  });
});

describe('extractSnippet', () => {
  const contents = new Map([
    ['a.ts', 'line1\nline2\nline3\nline4\nline5\nline6\nline7'],
  ]);

  it('extracts lines around the target with markers', () => {
    const snippet = extractSnippet(contents, 'a.ts', 4);
    expect(snippet).toBeDefined();
    expect(snippet).toContain('> ');
    expect(snippet).toContain('line4');
    // Should include context before and after
    expect(snippet).toContain('line2');
    expect(snippet).toContain('line6');
  });

  it('returns undefined for missing file', () => {
    expect(extractSnippet(contents, 'notfound.ts', 1)).toBeUndefined();
  });

  it('handles edge case at start of file', () => {
    const snippet = extractSnippet(contents, 'a.ts', 1, 2, 2);
    expect(snippet).toBeDefined();
    expect(snippet).toContain('line1');
  });

  it('handles edge case at end of file', () => {
    const snippet = extractSnippet(contents, 'a.ts', 7, 2, 2);
    expect(snippet).toBeDefined();
    expect(snippet).toContain('line7');
  });

  it('respects custom context size', () => {
    const snippet = extractSnippet(contents, 'a.ts', 4, 0, 0);
    expect(snippet).toBeDefined();
    // Only the target line
    const lines = snippet!.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('line4');
  });
});
