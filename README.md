<div align="center">
  <img src="assets/hero-banner.png" alt="FLAW - Flow Logic Audit Watch" width="100%">
</div>

# FLAW: Flow Logic Audit Watch

**The forensic code integrity auditor for AI-generated projects.**

FLAW scans your codebase and tells you what's actually broken, what's fake, and what's missing — in plain English. Built for developers who ship fast and need to know what's real.

Part of the **[FAIL Kit](https://github.com/resetroot99/The-FAIL-Kit)** ecosystem.

```
  ╺╸ FLAW v2.0.0

  ✓ Scanned my-app in 174ms
    23/100 · 0C 33H 14M · 49 issues · severe smell
```

---

## The Problem

AI coding tools (Cursor, Copilot, Cline) are incredible at generating code quickly. But they produce code that *looks* correct while lacking structural integrity. They hallucinate endpoints, create dead UI controls, mock out critical security checks, and build "happy path" flows that shatter the moment a user does something unexpected.

Standard linters (ESLint, Prettier) check syntax. Standard type checkers (TypeScript) check types. **FLAW checks reality.**

---

## Installation

```bash
# npm (recommended)
npm install -g flaw-kit

# or run directly
npx flaw-kit

# Python wrapper (requires Node.js)
pip install flaw-kit
```

Requires Node.js >= 18.

## Quick Start

```bash
# Interactive mode — launch and use /commands
flaw

# One-shot scan
flaw .

# Scan and export HTML report
flaw ../my-app --html

# Export everything at once
flaw . --html --fixes --roadmap --rules --purpose
```

---

## Interactive Mode

Run `flaw` with no arguments to enter the interactive REPL:

```
  ╺╸ FLAW v2.0.0

  ✓ Scanned ai-chatbot in 174ms
    23/100 · 0C 33H 14M · 49 issues

  ╺╸ /score
  ╺╸ /triage
  ╺╸ /symptoms
  ╺╸ /roadmap
  ╺╸ /purpose
  ╺╸ /html
  ╺╸ /rules
  ╺╸ /all
```

### Commands

| Command | Description |
|---------|-------------|
| `/scan [path]` | Scan the project (or a new path) |
| `/score` | Show score and category breakdown |
| `/report` | Print full terminal report |
| `/triage` | Show triage priority groups (P1/P2/P3) |
| `/symptoms` | Diagnose user-visible problems |
| `/promise` | Promise vs Reality analysis |
| `/roadmap` | Production readiness roadmap |
| `/purpose` | Purpose alignment plan |
| `/rules` | Generate agent rules file |
| `/html` | Export HTML report |
| `/json` | Export JSON report |
| `/fixes` | Export fix guide |
| `/prompt` | Generate AI-ready prompt |
| `/watch` | Enter watch mode (live re-scan) |
| `/all` | Export everything |
| `/help` | Show all commands |

Tab completion, command history, and fuzzy suggestions on typos.

---

## How It Works

<div align="center">
  <img src="assets/audit-flow.png" alt="FLAW Audit Flow Diagram" width="100%">
</div>

FLAW runs **12 static analyzers** across your codebase, scoring against 10 categories:

| # | Category | What It Checks | Max |
|---|----------|---------------|-----|
| 1 | Feature Reality | Stubs, TODOs, fake data, incomplete features | 15 |
| 2 | Frontend Wiring | Dead buttons, broken forms, missing handlers | 12 |
| 3 | Backend Integrity | Phantom endpoints, dead routes, shape mismatches | 12 |
| 4 | Data Model | Unscoped queries, missing timestamps, schema drift | 10 |
| 5 | Validation | Missing server-side validation, unbounded inputs | 8 |
| 6 | Error Handling | Silent catches, false success states, missing fallbacks | 8 |
| 7 | Security & Auth | Unprotected routes, hardcoded secrets, XSS risks | 12 |
| 8 | Maintainability | Giant files, dead code, duplicated logic | 8 |
| 9 | Testing | Missing tests for critical paths | 8 |
| 10 | Deployment | Missing configs, env leaks, observability gaps | 7 |

Plus a **Cross-Boundary Wiring** analyzer (broken imports, unused exports) and **AI Smell Index** (hallucinated refs, cargo-cult code).

### Scoring

- **100 points** across 10 categories
- **AI Smell Index** (0-10) — detects AI-generated anti-patterns
- **6 Launch Gates** — binary pass/fail for deployment readiness
- **Triage** — blast-radius priority scoring (P1/P2/P3)

### Ratings

| Rating | Meaning |
|--------|---------|
| Production-Ready | High integrity across all categories |
| Strong But Needs Targeted Fixes | Good foundation, specific flows need attention |
| Functional But Risky | Happy path works, lacks error handling and security |
| Misleading-Fragile | Looks complete, full of dead ends and silent failures |
| Cosmetic-Not-Trustworthy | A UI shell with no real logic |

---

## Export Options

```bash
flaw . --html              # Interactive HTML report with forensic panel
flaw . --json              # Machine-readable JSON
flaw . --markdown          # Markdown summary
flaw . --fixes             # Step-by-step fix guide (flaw-fixes.md)
flaw . --prompt            # AI-ready prompt (flaw-prompt.md)
flaw . --prompt-stdout     # Print prompt to stdout (pipe to clipboard)
flaw . --roadmap           # Production readiness roadmap (flaw-roadmap.md)
flaw . --purpose           # Purpose alignment plan (flaw-purpose-plan.md)
flaw . --rules             # Agent rules file (.cursorrules)
flaw . --rules-md          # Agent rules as AGENT_RULES.md
flaw . --watch             # Watch mode — re-scan on file changes
flaw . --out ./reports     # Output directory for exports
flaw . --quiet             # Suppress terminal output
flaw . --no-ignore         # Skip .flaw-ignore processing
```

---

## Guided Features

### Production Roadmap

A 5-phase prioritized plan to get your code production-ready:

1. **Security First** — things that can get you hacked today
2. **Fix What's Broken** — buttons that don't work, blank pages, stubs
3. **Protect Your Data** — validation, error handling, data integrity
4. **Make It Reliable** — async issues, state bugs, random crashes
5. **Polish & Maintain** — code quality, tests, documentation

Each item includes a plain English explanation, step-by-step fix instructions, and a copy-paste AI prompt.

### Purpose Alignment Plan

Compares what your README/docs promise vs what the code actually implements. For each gap (missing, stubbed, or partial feature), generates:

- Why it matters to users
- Step-by-step implementation guide
- Framework-specific tips (Next.js, FastAPI, Express, etc.)
- Ready-to-paste AI prompt

### Agent Rules Generator

Auto-generates `.cursorrules` or `AGENT_RULES.md` from your findings — coding rules derived from what's actually broken. Drop it in your project so your AI assistant stops making the same mistakes.

### Symptom Diagnosis

Maps technical findings to what users actually experience:
- "Buttons do nothing when clicked"
- "Data disappears after refresh"
- "Features say success but nothing happened"
- "Users can see each other's private data"

---

## Finding Labels

<div align="center">
  <img src="assets/labels-reference.png" alt="FLAW Finding Labels" width="100%">
</div>

| Label | Meaning |
|-------|---------|
| `[BROKEN]` | Code that will crash or fail to execute |
| `[MISLEADING]` | UI that claims success but did nothing |
| `[FRAGILE]` | Works on happy path but breaks easily |
| `[INCOMPLETE]` | Stubs, TODOs, half-finished implementations |
| `[UNSAFE]` | Security vulnerabilities and data leaks |
| `[UNVERIFIED]` | Missing validation or error handling |
| `[DEAD CONTROL]` | UI elements with no attached logic |
| `[FAKE FLOW]` | Hardcoded responses masquerading as logic |
| `[AUTH GAP]` | Missing authentication or authorization |
| `[SCHEMA DRIFT]` | Frontend/backend shape mismatches |
| `[MOCK LEAKAGE]` | Test/seed data in production paths |
| `[SILENT FAILURE]` | Errors caught but ignored |

---

## Configuration

### `.flaw-ignore`

Create a `.flaw-ignore` file in your project root to suppress specific findings:

```text
# Suppress by rule ID
FK-SA-SECRET-001

# Suppress by finding ID
FLAW-042

# Suppress a rule in specific files
FK-DM-DEMO-001 src/tests/**
FK-EH-SILENT-001 scripts/cleanup.ts
```

---

## Architecture

```
src/
  index.ts                CLI entry + arg parsing + REPL launch
  engine/
    repl.ts               Interactive REPL with 16 /commands
    scanner.ts            Runs all 12 analyzers
    scorer.ts             Category scoring, smell index, gates
    reporter.ts           Terminal output
    html-reporter.ts      Interactive HTML report
    triage.ts             Blast-radius priority scoring
    roadmap.ts            Production readiness roadmap
    purpose-plan.ts       Purpose alignment plan
    rules-generator.ts    Agent rules generator
    promise-reality.ts    README vs code comparison
    explain.ts            51 rule explanations in plain English
    symptoms.ts           User-visible problem diagnosis
    fix-reporter.ts       Fix guide generator
    prompt-reporter.ts    AI prompt generator
    dep-graph.ts          Import graph + downstream impact
    ignore.ts             .flaw-ignore support
    watcher.ts            Watch mode with live delta
  analyzers/              12 analyzer modules
  types/                  TypeScript interfaces
  utils/                  Shared utilities (fs, git, colors, patterns)
```

**Zero runtime dependencies** beyond `glob`. All analysis is regex-based — no AST parsing, no network calls, no telemetry.

---

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

If you discover a security vulnerability, please report it responsibly. See [SECURITY.md](SECURITY.md).

## License

MIT License — see [LICENSE.txt](LICENSE.txt)

---

Built by [resetroot99](https://github.com/resetroot99) and [ajakvani](https://github.com/ajakvani).

Part of the [FAIL Kit](https://github.com/resetroot99/The-FAIL-Kit) ecosystem — stop shipping broken code.
