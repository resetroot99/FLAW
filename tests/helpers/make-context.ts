import { AnalyzerContext } from '../../src/types/index.js';

export function makeContext(files: Record<string, string>, opts?: {
  root?: string;
  packageJson?: Record<string, unknown>;
  framework?: string;
}): AnalyzerContext {
  const root = opts?.root ?? '/test';
  const fileList = Object.keys(files);
  const fileContents = new Map(Object.entries(files));
  return {
    root,
    files: fileList,
    fileContents,
    packageJson: opts?.packageJson,
    framework: opts?.framework,
  };
}
