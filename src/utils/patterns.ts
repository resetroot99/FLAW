// Pattern matchers for static analysis

export interface PatternMatch {
  file: string;
  line: number;
  match: string;
  context: string;
}

export function searchFiles(
  fileContents: Map<string, string>,
  pattern: RegExp,
  fileFilter?: (file: string) => boolean,
): PatternMatch[] {
  const results: PatternMatch[] = [];
  for (const [file, content] of fileContents) {
    if (fileFilter && !fileFilter(file)) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(pattern);
      if (m) {
        results.push({
          file,
          line: i + 1,
          match: m[0],
          context: lines[i].trim(),
        });
      }
    }
  }
  return results;
}

export function countPattern(
  fileContents: Map<string, string>,
  pattern: RegExp,
  fileFilter?: (file: string) => boolean,
): number {
  let count = 0;
  for (const [file, content] of fileContents) {
    if (fileFilter && !fileFilter(file)) continue;
    const matches = content.match(new RegExp(pattern.source, 'g' + (pattern.flags.includes('i') ? 'i' : '')));
    if (matches) count += matches.length;
  }
  return count;
}

export function fileContains(content: string, pattern: RegExp): boolean {
  return pattern.test(content);
}

/**
 * Extract a code snippet from file contents with surrounding context lines.
 * Returns formatted string with line numbers.
 */
export function extractSnippet(
  fileContents: Map<string, string>,
  file: string,
  line: number,
  contextBefore: number = 2,
  contextAfter: number = 2,
): string | undefined {
  const content = fileContents.get(file);
  if (!content) return undefined;
  const lines = content.split('\n');
  const start = Math.max(0, line - 1 - contextBefore);
  const end = Math.min(lines.length, line + contextAfter);
  const snippet: string[] = [];
  const gutterWidth = String(end).length;
  for (let i = start; i < end; i++) {
    const lineNum = String(i + 1).padStart(gutterWidth, ' ');
    const marker = i === line - 1 ? '>' : ' ';
    snippet.push(`${marker} ${lineNum} | ${lines[i]}`);
  }
  return snippet.join('\n');
}

export function filesMatching(
  fileContents: Map<string, string>,
  pattern: RegExp,
  fileFilter?: (file: string) => boolean,
): string[] {
  const matches: string[] = [];
  for (const [file, content] of fileContents) {
    if (fileFilter && !fileFilter(file)) continue;
    if (pattern.test(content)) matches.push(file);
  }
  return matches;
}
