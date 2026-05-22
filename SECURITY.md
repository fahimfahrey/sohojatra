# Security Policy

## Supported Versions

Active branch: `main`. Patches apply to latest release only.

## Dependency Vulnerability Management

Automated scanning runs weekly via Dependabot (`.github/dependabot.yml`) and `npm audit` CI workflow (`.github/workflows/security-audit.yml`).

### Patch SLA

| Severity (CVSS) | Triage | Patch Deadline |
|-----------------|--------|----------------|
| Critical (9.0–10.0) | 24 hours | **7 calendar days** |
| High (7.0–8.9) | 3 business days | **30 calendar days** |
| Medium (4.0–6.9) | 7 business days | 90 calendar days |
| Low (< 4.0) | Next sprint | Best effort |

Clock starts when advisory becomes public OR Dependabot PR opens — whichever is earlier.

### Process

1. Dependabot opens PR on Monday 06:00 UTC.
2. On-call reviews, runs `npm audit`, confirms severity.
3. Merge after CI passes (build + lint + audit).
4. Tag release, deploy.
5. If patch unavailable upstream: pin to last-known-safe version, document in `SECURITY_KEY_ROTATION.md`, escalate.

### Version Pinning

All `dependencies` and `devDependencies` in `package.json` use **exact versions** (no `^` or `~`). This prevents unexpected transitive upgrades and makes audit results reproducible. `package-lock.json` is committed.

Dependabot uses `versioning-strategy: increase` — it edits exact pinned versions explicitly per PR.

## Reporting a Vulnerability

Email: security@coshare.example (replace with real contact).
Do **not** open public GitHub issues for vulnerabilities.

Include:
- Affected component / file
- Reproduction steps
- Impact assessment
- Suggested fix (if known)

Acknowledgement within 48 hours. Coordinated disclosure preferred.
