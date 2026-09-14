# Contributing

Thanks for contributing to Subscrio TypeScript.

## Hub and docs

- Product concepts and architecture: [subscrio/subscrio](https://github.com/subscrio/subscrio)
- API reference: [docs.subscrio.com](https://docs.subscrio.com)
- This package: [subscrio/subscrio-typescript](https://github.com/subscrio/subscrio-typescript)

## Prerequisites

- Node.js 20.19 or later
- PostgreSQL for E2E tests (see `tests/README.md`)

## Build and test

From this repository root (`core/typescript`):

```bash
npm install
npm run typecheck
npm run build
npm test
npm run test:coverage
```

E2E tests need `TEST_DATABASE_URL` or a local Postgres default. See `tests/README.md`.

The sample demo:

```bash
npx tsx sample/index.ts --automated --recreate
```

## Pull requests

- Keep changes focused and build-green.
- Prefer small PRs with a clear summary and test notes.
- Do not commit secrets (connection strings, Stripe keys, `.env` files).

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
