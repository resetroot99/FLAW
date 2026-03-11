# flaw-kit

**FLAW — Flow Logic Audit Watch**

Code integrity auditor for AI-generated projects. Scans your codebase and tells you what's broken, what's fake, and what's missing.

This is the Python wrapper for the FLAW engine. Requires Node.js >= 18.

## Install

```bash
pip install flaw-kit
```

## Usage

```bash
# Interactive mode
flaw

# One-shot scan
flaw .

# Export HTML report
flaw ../my-app --html
```

## Requirements

- Python >= 3.8
- Node.js >= 18

## Full Documentation

See the [GitHub repo](https://github.com/resetroot99/FLAW) for full documentation, features, and configuration.

## License

MIT
