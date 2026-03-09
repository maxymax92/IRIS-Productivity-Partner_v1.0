# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Iris, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please [open a private security advisory](https://github.com/maxymax92/IRIS-Productivity-Partner_v1.0/security/advisories/new) on GitHub.

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix or mitigation**: Depends on severity, but we aim for:
  - Critical: 24-48 hours
  - High: 1 week
  - Medium/Low: Next release cycle

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| Older   | No        |

## Security Best Practices for Deployers

- Never commit `.env` files or Supabase service keys to version control
- Use strong, unique values for `AUTH_SECRET` and `NEXTAUTH_SECRET`
- Restrict `allowed_emails` to authorized users only
- Enable Row Level Security (RLS) on all Supabase tables
- Rotate API keys periodically
- Keep dependencies up to date
