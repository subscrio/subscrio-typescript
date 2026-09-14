# Security Policy

## Supported Versions

Security fixes are applied to the latest released version of `subscrio` on npm.

## Reporting a Vulnerability

Please report security issues privately. Do not open a public GitHub issue for vulnerabilities.

- Email: security@subscrio.com
- Or use GitHub Security Advisories on the [subscrio-typescript](https://github.com/subscrio/subscrio-typescript) repository

Include steps to reproduce, affected versions, and impact. We will acknowledge reports and coordinate a fix and disclosure timeline.

## Notes

- Do not log database connection strings or Stripe secrets. Passwords in test output are redacted.
- Schema drop requires the configured admin passphrase when a hash is stored.
- Stripe webhook signatures should be verified with `constructStripeEvent` before `processStripeEvent`.
