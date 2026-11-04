# Security

Use private reporting for security issues.

## Reporting a vulnerability

Do not include credentials, personal data, or exploit details in public issues. Use GitHub's
private vulnerability reporting feature when available, or contact the repository maintainer
privately to arrange a confidential report. Include the affected version, reproduction steps,
impact, and a suggested mitigation. Do not test against systems you do not own.

## Configuration

- Use a new, random JWT signing secret and new database credentials for each deployment.
- Keep API keys, OAuth secrets, service tokens, environment files, cookie jars, and local agent
  settings outside Git. Examples must contain placeholders only.
- Store production secrets in a secret manager; avoid plaintext deployment templates and logs.
- The token vault and scheduler require IAM authentication at their Lambda Function URLs.
  Do not expose them through unauthenticated gateways or trust caller-provided identity headers.
- Asset URL imports accept public HTTPS on port 443, at most three redirects, 50 MiB, and a
  30-second total deadline. Private, loopback, link-local, reserved, and mixed DNS answers are
  rejected at connection time. Keep outbound network restrictions in production as defense in depth.

## Credential incidents

Revoke exposed provider keys first. Removing a file or rewriting Git history does not revoke a
credential, erase other clones, or purge GitHub pull-request references and cached views.
Recreate credentials only when a deployment actually needs them. Never reuse historical values.

Before a public release, follow [the publication checklist](PUBLICATION.md).
