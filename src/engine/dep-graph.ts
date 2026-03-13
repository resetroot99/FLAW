// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
// Dependency chain analysis — show downstream impact of broken files
import type { AnalyzerContext, Finding } from '../types/index.js';

export interface DepGraph {
  // reverse adjacency: file -> files that import it
  dependedOnBy: Map<string, Set<string>>;
}

export function buildDepGraph(ctx: AnalyzerContext): DepGraph {
  const dependedOnBy = new Map<string, Set<string>>();

  for (const [file, content] of ctx.fileContents) {
    const lines = content.split('\n');
    for (const line of lines) {
      // JS/TS: import ... from './path'
      const jsImport = line.match(/(?:import|from)\s+['"](\.[^'"]+)['"]/);
      if (jsImport) {
        const resolved = resolveImport(file, jsImport[1], ctx.files);
        if (resolved) {
          const set = dependedOnBy.get(resolved) || new Set();
          set.add(file);
          dependedOnBy.set(resolved, set);
        }
      }

      // Python: from .module import ... or from app.module import ...
      const pyImport = line.match(/from\s+(\S+)\s+import/);
      if (pyImport && /\.py$/.test(file)) {
        const modulePath = pyImport[1].replace(/\./g, '/');
        // Find matching file
        const target = ctx.files.find(f =>
          f.endsWith(`${modulePath}.py`) ||
          f.endsWith(`${modulePath}/__init__.py`)
        );
        if (target) {
          const set = dependedOnBy.get(target) || new Set();
          set.add(file);
          dependedOnBy.set(target, set);
        }
      }
    }
  }

  return { dependedOnBy };
}

function resolveImport(fromFile: string, importPath: string, allFiles: string[]): string | undefined {
  const dir = fromFile.split('/').slice(0, -1).join('/');
  const resolved = dir ? `${dir}/${importPath}`.replace(/\/\.\//g, '/') : importPath.replace(/^\.\//, '');
  const normalized = resolved.replace(/\/+/g, '/');
  const base = normalized.replace(/\.(js|jsx|ts|tsx)$/, '');

  return allFiles.find(f => {
    const fBase = f.replace(/\.(js|jsx|ts|tsx)$/, '');
    return f === normalized || fBase === base ||
      f === `${base}.ts` || f === `${base}.tsx` ||
      f === `${base}.js` || f === `${base}.jsx` ||
      f === `${normalized}/index.ts` || f === `${normalized}/index.tsx`;
  });
}

export function getDownstream(graph: DepGraph, file: string, maxDepth: number = 4): string[] {
  const visited = new Set<string>();
  const queue: { file: string; depth: number }[] = [{ file, depth: 0 }];

  while (queue.length > 0) {
    const { file: current, depth } = queue.shift()!;
    if (visited.has(current) || depth > maxDepth) continue;
    visited.add(current);

    const dependents = graph.dependedOnBy.get(current);
    if (dependents) {
      for (const dep of dependents) {
        if (!visited.has(dep)) {
          queue.push({ file: dep, depth: depth + 1 });
        }
      }
    }
  }

  visited.delete(file); // Don't include the source file itself
  return Array.from(visited);
}

export function enrichFindingsWithDownstream(findings: Finding[], graph: DepGraph): Finding[] {
  return findings.map(f => {
    if (f.status !== 'open') return f;
    if (f.severity !== 'critical' && f.severity !== 'high') return f;

    const downstream = getDownstream(graph, f.location.file);
    if (downstream.length === 0) return f;

    // Add downstream info to evidenceRefs
    const downstreamNote = `Affects ${downstream.length} downstream file${downstream.length > 1 ? 's' : ''}: ${downstream.slice(0, 4).join(', ')}${downstream.length > 4 ? '...' : ''}`;
    const existingRefs = f.evidenceRefs || [];

    return {
      ...f,
      evidenceRefs: [...existingRefs, downstreamNote],
    };
  });
}
