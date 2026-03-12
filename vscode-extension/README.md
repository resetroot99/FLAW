# FLAW — Flow Logic Audit Watch

**Forensic code integrity auditor for AI-generated projects.**

FLAW scans your code and tells you what's broken, what's fake, and what's missing — right in your editor.

## Features

- **Real-time diagnostics** — findings appear as squiggles in the editor
- **Status bar** — see critical/high counts at a glance
- **Quick fixes** — suggested fixes for common issues
- **HTML report** — full FLAW report in a VS Code panel (runs `flaw-kit` under the hood)
- **Workspace scan** — analyze your entire project at once

## What it catches

| Label | Example |
|-------|---------|
| `[Dead Control]` | Buttons with onClick that call nothing |
| `[Silent Failure]` | `catch(e) {}` swallowing errors |
| `[Mock Leakage]` | `mockData` in production paths |
| `[Unsafe]` | Hardcoded API keys in source |
| `[Incomplete]` | `def get_data(): pass` stubs |
| `[Fake Flow]` | Success toast before async completes |

## Commands

- `FLAW: Scan Current File` — analyze the active file
- `FLAW: Scan Workspace` — analyze all supported files
- `FLAW: Show Report` — open the HTML report panel
- `FLAW: Show Score` — quick pick with severity breakdown

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `flaw.enableOnSave` | `true` | Analyze on file save |
| `flaw.enableRealTime` | `false` | Analyze on every keystroke (debounced) |
| `flaw.excludePatterns` | `[node_modules, dist, build, .git]` | Files to skip |
| `flaw.severityMap` | critical=Error, high=Error, medium=Warning | Map to VS Code severity |

## Requirements

For the full HTML report panel, install the CLI: `npm install -g flaw-kit`

## Links

- [GitHub](https://github.com/resetroot99/FLAW)
- [npm](https://www.npmjs.com/package/flaw-kit)
- [FAIL Kit](https://github.com/resetroot99/The-FAIL-Kit)
