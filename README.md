# Subscrio TypeScript Core Library

<p align="center">
  <a href="https://subscrio.com/typescript-entitlement-library/">
    <img src="https://subscrio.com/assets/images/logo/logo-576x110.png" alt="Subscrio" width="220">
  </a>
</p>

<p align="center">
  <strong>The entitlement engine that translates subscriptions into feature access.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/subscrio"><img src="https://img.shields.io/npm/v/subscrio?style=flat-square&logo=npm" alt="npm version"></a>
  <a href="https://github.com/subscrio/subscrio-typescript/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Node-%3E%3D20.19-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
</p>

<p align="center">
  <a href="https://subscrio.com"><img src="https://img.shields.io/badge/Website-subscrio.com-696dc0?style=flat-square" alt="Website"></a>
  <a href="https://docs.subscrio.com"><img src="https://img.shields.io/badge/Docs-docs.subscrio.com-696dc0?style=flat-square" alt="Documentation"></a>
  <a href="https://github.com/subscrio/subscrio"><img src="https://img.shields.io/badge/Hub-subscrio%2Fsubscrio-181717?style=flat-square&logo=github" alt="Hub"></a>
  <a href="https://github.com/subscrio/subscrio-typescript/issues"><img src="https://img.shields.io/badge/Issues-report-181717?style=flat-square&logo=github" alt="Issues"></a>
</p>

An open-source TypeScript entitlement library for plan-based feature access, limits, subscriptions, customer overrides, and optional Stripe event processing.

See the [Subscrio hub README](https://github.com/subscrio/subscrio) for concepts, architecture, and feature resolution.

## Features

- Feature entitlements: toggles, numeric limits, text values, and customer overrides
- Plans and billing cycles: model packages and subscription timing without processing payments
- Subscription lifecycle: trials, renewals, cancellations, and effective access dates
- Stripe integration: process supported, verified Stripe subscription events
- PostgreSQL: Drizzle ORM with a published type-safe npm package. Schema install/drop/migrate SQL is also generated for SQL Server; the TypeScript query runtime is PostgreSQL.
- Hooks: before/after events for customers, subscriptions, and inbound Stripe payloads
- Config sync: file or JSON catalog sync for products, features, plans, and billing cycles

## Installation

```bash
npm install subscrio
```

**Prerequisites**

- A TypeScript or JavaScript application
- PostgreSQL (create an empty database first; Subscrio installs schema inside it)

## Quick Start

Set `DATABASE_URL`, then construct Subscrio and run the schema installer once.

`loadConfig()` reads environment variables into a `SubscrioConfig` object. The only required value is `DATABASE_URL` (the PostgreSQL connection string). Pass that object to `new Subscrio(config)`. You can also build `SubscrioConfig` in code instead of using `loadConfig()`. See [Configuration](#configuration) and the [core overview](https://docs.subscrio.com/reference/core-overview) for the full object.

```typescript
import { Subscrio, loadConfig } from 'subscrio';

const config = loadConfig();
const subscrio = new Subscrio(config);

await subscrio.installSchema('your-admin-passphrase');

const product = await subscrio.products.createProduct({
  key: 'my-saas',
  displayName: 'My SaaS Product'
});

const feature = await subscrio.features.createFeature({
  key: 'max-users',
  displayName: 'Maximum Users',
  valueType: 'numeric',
  defaultValue: '10'
});

await subscrio.products.associateFeature(product.key, feature.key);

const plan = await subscrio.plans.createPlan({
  productKey: product.key,
  key: 'pro-plan',
  displayName: 'Pro Plan'
});

await subscrio.plans.setFeatureValue(plan.key, feature.key, '100');

const billingCycle = await subscrio.billingCycles.createBillingCycle({
  planKey: plan.key,
  key: 'monthly',
  displayName: 'Monthly',
  durationValue: 1,
  durationUnit: 'months'
});

const customer = await subscrio.customers.createCustomer({
  key: 'customer-123',
  displayName: 'Acme Corp'
});

await subscrio.subscriptions.createSubscription({
  key: 'sub-001',
  customerKey: customer.key,
  billingCycleKey: billingCycle.key
});

const maxUsers = await subscrio.featureChecker.getValueForCustomer(
  customer.key,
  product.key,
  'max-users'
);
```

Public APIs use string **keys**, not internal IDs. DTOs and types are exported from `subscrio`.

## Configuration

`SubscrioConfig` is the object passed to `new Subscrio(config)`. Only `database.connectionString` is required. Everything else is optional: SSL, pool size, Stripe, logging, hooks, and initial catalog sync.

`loadConfig()` fills that object from environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DATABASE_SSL` | No | `true` to enable SSL |
| `DATABASE_POOL_SIZE` | No | Connection pool size (default: driver preset) |
| `STRIPE_SECRET_KEY` | No | Stripe secret key for billing helpers |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook endpoint secret (`whsec_...`) for `constructStripeEvent` |
| `ADMIN_PASSPHRASE` | No | Default admin passphrase for schema install and drop |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, or `error` |

**Connection string example:** `postgresql://postgres:password@localhost:5432/subscrio`

To define products, features, plans, and billing cycles in JSON and apply them with `configSync` or `initialConfig`, see [configuration sync](https://docs.subscrio.com/reference/config-sync).

The full `SubscrioConfig` shape is in the [core overview](https://docs.subscrio.com/reference/core-overview).

## Database setup

1. Create an empty PostgreSQL database.
2. Point Subscrio at it with `DATABASE_URL` or `SubscrioConfig.database`.
3. On first run, call `installSchema(adminPassphrase)`.
4. After upgrading the package, call `migrate()`.

```typescript
const version = await subscrio.verifySchema();
if (version == null) {
  await subscrio.installSchema('your-admin-passphrase');
}

await subscrio.migrate();
```

Other instance methods: `dropSchema(adminPassphrase)` (destructive; tests/dev only — the passphrase is required when a hash was stored at install), `runInitialConfigSync()` (when `SubscrioConfig.initialConfig` is set), and `close()`.

## Stripe

Stripe support is optional. You only need it if you want Subscrio to apply verified Stripe subscription events to local customers and subscriptions. You can create and manage subscriptions through the API without Stripe.

Subscrio does **not** charge cards. Verify webhook signatures in your app (or via `constructStripeEvent` when `stripe.webhookSecret` is set), then pass events to `processStripeEvent`. Create subscriptions through Checkout or your own Stripe API calls, not a placeholder create helper.

```typescript
const event = subscrio.stripe.constructStripeEvent(rawBody, signatureHeader);
await subscrio.stripe.processStripeEvent(event);

const { url } = await subscrio.stripe.createCheckoutSession({
  customerKey: customer.key,
  billingCycleKey: billingCycle.key,
  successUrl: 'https://example.com/success',
  cancelUrl: 'https://example.com/cancel'
});
```

See [Stripe integration](https://docs.subscrio.com/reference/stripe-integration) and the [hub overview](https://github.com/subscrio/subscrio#stripe-integration).

## Documentation

Full API reference, hooks, and extension guides live on [docs.subscrio.com](https://docs.subscrio.com):

- [Core overview](https://docs.subscrio.com/reference/core-overview)
- [Feature checker and resolution](https://docs.subscrio.com/reference/feature-checker)
- [Hooks](https://docs.subscrio.com/reference/hooks)
- [How to extend](https://docs.subscrio.com/reference/how-to-extend)

**Services on `Subscrio`:** `products`, `features`, `plans`, `billingCycles`, `customers`, `subscriptions`, `featureChecker`, `stripe`, `configSync`, `hooks`.

Handle `ValidationError`, `NotFoundError`, `ConflictError`, `DomainError`, and `ConfigurationError` from `subscrio`.

## Building and testing

From this repository root:

```bash
npm install
npm run typecheck
npm run build
npm test
```

`npm test` runs tests against PostgreSQL. Set `TEST_DATABASE_URL` or configure `.env` (see [tests/README.md](tests/README.md)). Extension packages (`subscrio-audit-log`, `subscrio-payments`) live in [subscrio-extensions-audit-log](https://github.com/subscrio/subscrio-extensions-audit-log) and [subscrio-extensions-payments](https://github.com/subscrio/subscrio-extensions-payments).

## License

MIT. See [LICENSE](LICENSE).

## Contributing

Issues and pull requests welcome in this repo. See [CONTRIBUTING.md](CONTRIBUTING.md). Org-wide guidelines: [CONTRIBUTING](https://github.com/subscrio/subscrio/blob/main/CONTRIBUTING.md).

## Support

- [Subscrio hub](https://github.com/subscrio/subscrio)
- [Report issues](https://github.com/subscrio/subscrio-typescript/issues)
- [Discussions](https://github.com/subscrio/subscrio/discussions) (org-wide)
- [Testing guide](tests/README.md)

<p align="center">
  Maintained by <a href="https://github.com/jasenf">Jasen Fici</a> · Part of the <a href="https://github.com/subscrio">Subscrio</a> org
</p>
