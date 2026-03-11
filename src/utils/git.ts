import { execSync } from 'node:child_process';

export function getGitBranch(root: string): string | undefined {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}

export function getGitCommit(root: string): string | undefined {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}

export function getGitRepoName(root: string): string | undefined {
  try {
    const url = execSync('git remote get-url origin', { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    // https://github.com/vercel/ai-chatbot.git → ai-chatbot
    // git@github.com:vercel/ai-chatbot.git → ai-chatbot
    const match = url.match(/\/([^/]+?)(?:\.git)?$/);
    return match?.[1] || undefined;
  } catch {
    return undefined;
  }
}
