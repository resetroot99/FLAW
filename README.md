<div align="center">
  <img src="assets/hero-banner.png" alt="FLAW - Flow Logic Audit Watch" width="100%">
</div>

# FLAW: Flow Logic Audit Watch

**The forensic code integrity auditor for AI-generated projects.**

FLAW is a static analysis engine designed specifically to catch the unique failure modes of AI-assisted development. It doesn't care about your tabs vs. spaces. It cares if your "Submit Order" button is wired to a function that doesn't exist, if your backend silently swallows database errors, or if your authentication middleware is just a mock returning `true`.

Part of the **[FAIL Kit](https://github.com/resetroot99/The-FAIL-Kit)** ecosystem.

---

## The Problem

AI coding tools (Cursor, Copilot, Cline) are incredible at generating code quickly. But they produce code that *looks* correct while lacking structural integrity. They hallucinate endpoints, create dead UI controls, mock out critical security checks, and build "happy path" flows that shatter the moment a user does something unexpected.

Standard linters (ESLint, Prettier) check syntax. Standard type checkers (TypeScript) check types. **FLAW checks reality.**

## How It Works

FLAW scans your codebase across 10 critical integrity categories, hunting for the specific patterns of AI hallucination and lazy implementation.

<div align="center">
  <img src="assets/audit-flow.png" alt="FLAW Audit Flow Diagram" width="100%">
</div>

### The 10 Analyzers

1. **Feature Reality & End-to-End Integrity**: Detects UI claims that have no backing implementation.
2. **Frontend Wiring**: Finds dead buttons, unhandled forms, and disconnected state.
3. **Backend / API Integrity**: Catches fake endpoints, missing persistence, and shape mismatches.
4. **Data Model & Persistence**: Identifies schema drift, missing tenant isolation, and nullable critical fields.
5. **Validation & Business Rules**: Flags missing server-side validation and client-only checks.
6. **Error Handling & Failure Honesty**: Exposes silent catches, false success states, and missing fallbacks.
7. **Security, Auth & Authorization**: Detects hardcoded secrets, mock auth, and missing route protection.
8. **Maintainability & Code Health**: Finds massive files, deep nesting, and commented-out code blocks.
9. **Testing & Runtime Verification**: Checks for missing test coverage on critical paths.
10. **Deployment & Observability**: Ensures basic operational readiness (README, CI, env vars).

---

## Installation

```bash
# Install globally
npm install -g flaw

# Or run directly via npx
npx flaw --scan ./my-project
```

## Usage

Run a basic scan on your current directory:

```bash
flaw --scan .
```

<div align="center">
  <img src="assets/terminal-demo.png" alt="FLAW Terminal Output" width="80%">
</div>

### Export Options

FLAW generates actionable artifacts for both humans and AI agents:

```bash
# Generate a human-readable HTML report
flaw --scan . --html --out ./reports

# Generate a Markdown fix guide
flaw --scan . --fixes --out ./reports

# Generate a prompt to feed back into your AI coding tool
flaw --scan . --prompt --out ./reports

# Generate a strategic roadmap for fixing the codebase
flaw --scan . --roadmap --out ./reports

# Run in watch mode during development
flaw --scan . --watch
```

---

## Finding Labels

FLAW categorizes issues using a specific taxonomy of failure modes.

<div align="center">
  <img src="assets/labels-reference.png" alt="FLAW Finding Labels" width="100%">
</div>

- **[BROKEN]**: Code that will crash or fail to execute.
- **[MISLEADING]**: UI that claims success but did nothing.
- **[FRAGILE]**: Code that works on the happy path but breaks easily.
- **[INCOMPLETE]**: Stubs, TODOs, and half-finished implementations.
- **[UNSAFE]**: Security vulnerabilities and data leaks.
- **[UNVERIFIED]**: Missing validation or error handling.
- **[OVERENGINEERED]**: Unnecessary complexity introduced by AI.
- **[DEAD CONTROL]**: UI elements with no attached logic.
- **[FAKE FLOW]**: Hardcoded responses masquerading as logic.
- **[AUTH GAP]**: Missing authentication or authorization checks.
- **[SCHEMA DRIFT]**: Mismatches between frontend expectations and backend reality.
- **[MOCK LEAKAGE]**: Test or seed data exposed in production paths.
- **[SILENT FAILURE]**: Errors that are caught but ignored.
- **[PRODUCTION-BLOCKING]**: Critical issues that must be fixed before launch.

---

## The Score Card

Every audit produces a comprehensive score card, grading your project's integrity and assigning a launch-readiness rating.

<div align="center">
  <img src="assets/score-card.png" alt="FLAW Score Card" width="80%">
</div>

### Ratings

- **PRODUCTION-READY**: High integrity across all categories.
- **STRONG BUT NEEDS TARGETED FIXES**: Good foundation, but specific critical flows need attention.
- **FUNCTIONAL BUT RISKY**: Works on the happy path, but lacks error handling and security depth.
- **MISLEADING-FRAGILE**: Looks complete, but full of dead ends, mock data, and silent failures.
- **COSMETIC-NOT-TRUSTWORTHY**: A UI shell with no real backend or logic.

---

## Ignoring Rules

Sometimes you know what you're doing. Create a `.flaw-ignore` file in your project root:

```text
# Ignore a specific rule globally
FK-SA-SECRET-001

# Ignore a specific finding ID
finding_1710428192

# Ignore a rule in a specific file or directory
FK-DM-DEMO-001 src/tests/**
FK-EH-SILENT-001 scripts/cleanup.ts

# Ignore entire files or directories
tests/e2e/**
scripts/legacy/**
```

## License

MIT License. See `LICENSE` for details.

---
*Built for the FAIL Kit ecosystem. Stop shipping broken code.*
