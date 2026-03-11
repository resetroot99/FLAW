# Contributing to FLAW

Thanks for your interest in contributing to FLAW.

## Getting Started

```bash
# Clone the repo
git clone https://github.com/resetroot99/FLAW.git
cd FLAW

# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev -- .
```

## Project Structure

- `src/analyzers/` — Static analysis modules (one per category)
- `src/engine/` — Core engine (scanner, scorer, reporters, REPL)
- `src/types/` — TypeScript interfaces
- `src/utils/` — Shared utilities

## Adding a New Analyzer

1. Create `src/analyzers/your-analyzer.ts`
2. Export a function matching the `(ctx: AnalyzerContext) => AnalyzerResult` signature
3. Register it in `src/engine/scanner.ts`
4. Add scoring in `src/engine/scorer.ts` if it maps to a new category

## Adding a New Rule

Rules are defined inline in their analyzer. Each finding uses:
- `ruleId` — format: `FK-{CATEGORY}-{NAME}-{NUM}` (e.g., `FK-SA-AUTH-001`)
- `categoryId` — two-letter category code (e.g., `SA`, `FW`, `BE`)
- `severity` — `critical`, `high`, `medium`, `low`, or `info`

Add a plain English explanation in `src/engine/explain.ts` so beginners understand the issue.

## Code Style

- TypeScript, strict mode
- No runtime dependencies beyond `glob`
- All analysis is regex-based (no AST parsing)
- Keep it simple — if a regex can do it, use a regex

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run build` to verify it compiles
4. Test against a real project: `npm run dev -- /path/to/project`
5. Open a PR with a clear description of what you changed and why

## Reporting Issues

Open an issue at https://github.com/resetroot99/FLAW/issues with:
- What you expected
- What actually happened
- Steps to reproduce
- Project type (Next.js, FastAPI, etc.) if relevant
