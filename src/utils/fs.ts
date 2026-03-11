import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { glob } from 'glob';

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.astro',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.php', '.cs', '.swift',
  '.css', '.scss', '.less',
  '.html', '.htm',
  '.json', '.yaml', '.yml', '.toml',
  '.sql', '.graphql', '.gql',
  '.sh', '.bash', '.zsh',
  '.md', '.mdx',
  '.env', '.env.example', '.env.local',
  '.prisma',
]);

const IGNORE_DIRS = [
  'node_modules', '.next', '.nuxt', '.svelte-kit', 'dist', 'build',
  '.git', '.cache', 'coverage', '__pycache__', '.turbo', '.vercel',
  'vendor', 'target', '.output', '.nitro',
];

export async function collectFiles(root: string): Promise<string[]> {
  const ignorePattern = IGNORE_DIRS.map(d => `**/${d}/**`);
  const files = await glob('**/*', {
    cwd: root,
    nodir: true,
    dot: true,
    ignore: ignorePattern,
    absolute: false,
  });

  // Include dotfiles like .gitignore, .env.example alongside code files
  return files.filter(f => {
    const name = f.split('/').pop() || '';
    return CODE_EXTENSIONS.has(extname(f)) || /^\.(gitignore|env|env\.\w+|dockerignore|editorconfig|prettierrc|eslintrc)$/i.test(name);
  });
}

export function readFileSafe(root: string, file: string): string | null {
  try {
    const fullPath = join(root, file);
    const stat = statSync(fullPath);
    // Skip files larger than 1MB
    if (stat.size > 1_048_576) return null;
    return readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

export function loadFileContents(root: string, files: string[]): Map<string, string> {
  const contents = new Map<string, string>();
  for (const file of files) {
    const content = readFileSafe(root, file);
    if (content !== null) {
      contents.set(file, content);
    }
  }
  return contents;
}

export function findPackageJson(root: string): Record<string, unknown> | null {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function detectFramework(packageJson: Record<string, unknown> | null): string | undefined {
  if (!packageJson) return undefined;
  const deps = {
    ...(packageJson.dependencies as Record<string, string> || {}),
    ...(packageJson.devDependencies as Record<string, string> || {}),
  };
  if (deps['next']) return 'nextjs';
  if (deps['nuxt'] || deps['nuxt3']) return 'nuxt';
  if (deps['@sveltejs/kit']) return 'sveltekit';
  if (deps['astro']) return 'astro';
  if (deps['remix'] || deps['@remix-run/react']) return 'remix';
  if (deps['react']) return 'react';
  if (deps['vue']) return 'vue';
  if (deps['svelte']) return 'svelte';
  if (deps['express']) return 'express';
  if (deps['fastify']) return 'fastify';
  if (deps['hono']) return 'hono';
  if (deps['django']) return 'django';
  if (deps['flask']) return 'flask';
  return undefined;
}

export function isSourceFile(file: string): boolean {
  const ext = extname(file);
  return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.py', '.rb', '.go', '.rs', '.java', '.php'].includes(ext);
}

export function isTestFile(file: string): boolean {
  return /\.(test|spec|e2e)\.[jt]sx?$/.test(file) ||
    /\/__tests__\//.test(file) ||
    /\/tests?\//.test(file) ||
    /test_.*\.py$/.test(file) ||
    /_test\.go$/.test(file);
}

export function isConfigFile(file: string): boolean {
  const name = file.split('/').pop() || '';
  return /^(tsconfig|jest\.config|vitest\.config|webpack\.config|vite\.config|next\.config|nuxt\.config|tailwind\.config|postcss\.config|eslint|\.eslintrc|prettier|\.prettierrc|babel\.config|rollup\.config)/.test(name);
}
