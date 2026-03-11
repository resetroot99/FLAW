// Shared ANSI color constants
export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
};

export function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return c.red;
    case 'high': return c.yellow;
    case 'medium': return c.cyan;
    case 'low': return c.dim;
    default: return c.dim;
  }
}

export function bar(score: number, max: number, width: number = 20): string {
  const filled = Math.round((score / max) * width);
  const empty = width - filled;
  const pct = score / max;
  const color = pct >= 0.75 ? c.green : pct >= 0.5 ? c.yellow : c.red;
  return `${color}${'█'.repeat(filled)}${c.dim}${'░'.repeat(empty)}${c.reset}`;
}
