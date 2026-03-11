# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in FLAW, please report it responsibly.

**Do not open a public issue.**

Instead, email the maintainers or use GitHub's private vulnerability reporting:
https://github.com/resetroot99/FLAW/security/advisories/new

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Scope

FLAW is a static analysis tool that reads source code files. It does not:
- Execute any code from the scanned project
- Make network requests
- Collect or transmit telemetry
- Modify any files in the scanned project

Security concerns are primarily around:
- Path traversal in file scanning
- Regex denial of service (ReDoS) in analysis patterns
- Sensitive data exposure in exported reports
