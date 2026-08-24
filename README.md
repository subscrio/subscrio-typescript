# subscrio

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
  <img src="https://img.shields.io/badge/TypeScript-5+-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/PostgreSQL-Ready-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
</p>

<p align="center">
  <a href="https://subscrio.com"><img src="https://img.shields.io/badge/Website-subscrio.com-696dc0?style=flat-square" alt="Website"></a>
  <a href="https://docs.subscrio.com"><img src="https://img.shields.io/badge/Docs-docs.subscrio.com-696dc0?style=flat-square" alt="Documentation"></a>
  <a href="https://github.com/subscrio/subscrio"><img src="https://img.shields.io/badge/Hub-subscrio%2Fsubscrio-181717?style=flat-square&logo=github" alt="Hub"></a>
  <a href="https://github.com/subscrio/subscrio-typescript/issues"><img src="https://img.shields.io/badge/Issues-report-181717?style=flat-square&logo=github" alt="Issues"></a>
</p>

An open-source TypeScript entitlement library for plan-based feature access, limits, subscriptions, customer overrides, and optional Stripe event processing.

See the [Subscrio hub README](https://github.com/subscrio/subscrio) for cross-cutting concepts and architecture.

## Features

- 🎯 **Feature Entitlements** - Toggle access, numeric limits, text values, and customer overrides
- 💳 **Plans and Billing Cycles** - Model packages and subscription timing without processing payments
- 🔄 **Subscription Lifecycle** - Track trials, renewals, cancellations, and effective access dates
- 🏷️ **Stripe Integration** - Process supported, verified Stripe subscription events
- 🗄️ **PostgreSQL Ready** - Built on Drizzle ORM with full type safety
- 📊 **Feature Resolution** - Smart hierarchy: subscription overrides → plan values → defaults
- ⚡ **TypeScript First** - Full type safety and excellent developer experience

## Installation

```bash
npm install subscrio
```

**Prerequisites:**
- A TypeScript application that meets the package engine requirements
- PostgreSQL database

## Quick Start

```typescript
import { Subscrio } from 'subscrio';

// Initialize the library
const subscrio = new Subscrio({
  database: {
    connectionString: 'postgresql://user:password@localhost:5432/mydb'
  }
});

// Install database schema (first time only)
await subscrio.installSchema();

// Create a product
const product = await subscrio.products.createProduct({
  key: 'my-saas',
  displayName: 'My SaaS Product'
});

// Create a feature
const feature = await subscrio.features.createFeature({
  key: 'max-users',
  displayName: 'Maximum Users',
  valueType: 'numeric',
  defaultValue: '10'
});

// Associate feature with product (using keys, not IDs)
await subscrio.products.associateFeature(product.key, feature.key);

// Create a plan (using productKey, not productId)
const plan = await subscrio.plans.createPlan({
  productKey: product.key,
  key: 'pro-plan',
  displayName: 'Pro Plan'
});

// Set feature value on plan (using keys, not IDs)
await subscrio.plans.setFeatureValue(plan.key, feature.key, '100');

// Create a billing cycle for the plan (required for subscriptions)
const billingCycle = await subscrio.billingCycles.createBillingCycle({
  planKey: plan.key,
  key: 'monthly',
  displayName: 'Monthly',
  durationValue: 1,
  durationUnit: 'months'
});

// Create a customer (using key, not externalId)
const customer = await subscrio.customers.createCustomer({
  key: 'customer-123',
  displayName: 'Acme Corp'
});

// Create a subscription (using keys and billingCycleKey, not IDs)
const subscription = await subscrio.subscriptions.createSubscription({
  key: 'sub-001',
  customerKey: customer.key,
  billingCycleKey: billingCycle.key
});

// Check feature access (requires customerKey, productKey, and featureKey)
const maxUsers = await subscrio.featureChecker.getValueForCustomer(
  customer.key,
  product.key,
  'max-users'
);
console.log(`Customer can have ${maxUsers} users`); // "100"
```

## Building and testing

From this repository root (`subscrio-typescript`):

```bash
npm install
npm run typecheck
npm run build
npm test
```

`npm test` runs E2E tests against PostgreSQL. Set `TEST_DATABASE_URL` or configure `.env` (see [tests/README.md](tests/README.md)). Extension packages (`subscrio-audit-log`, `subscrio-payments`) are separate repositories with their own test suites.

## API Reference

### Core Services

- **`subscrio.products`** - Product management
- **`subscrio.features`** - Feature entitlement definitions
- **`subscrio.plans`** - Subscription plan management
- **`subscrio.billingCycles`** - Billing cycle management
- **`subscrio.customers`** - Customer management
- **`subscrio.subscriptions`** - Subscription lifecycle
- **`subscrio.featureChecker`** - Feature access checking
- **`subscrio.stripe`** - Stripe integration
- **`subscrio.configSync`** - Sync products, features, plans, and billing cycles from JSON
- **`subscrio.hooks`** - Before/after hooks for customers, subscriptions, and inbound Stripe events

### Instance Methods

- **`installSchema(adminPassphrase?)`** - Install database schema
- **`verifySchema()`** - Check if schema is installed
- **`migrate()`** - Run pending database migrations
- **`runInitialConfigSync()`** - Apply `initialConfig` from constructor when configured
- **`dropSchema()`** - Drop all database tables (destructive)
- **`close()`** - Close database connections

## Configuration

```typescript
import { Subscrio } from 'subscrio';

const subscrio = new Subscrio({
  database: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true',  // Optional
    poolSize: parseInt(process.env.DATABASE_POOL_SIZE || '10')  // Optional
  },
  adminPassphrase: process.env.ADMIN_PASSPHRASE,  // Optional, min 8 chars
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY  // Optional
  },
  logging: {
    level: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info'  // Optional
  }
});
```

## Feature Resolution Hierarchy

Subscrio uses a consistent hierarchy for feature values. See the [Subscrio hub README](https://github.com/subscrio/subscrio#feature-resolution-hierarchy) for details.

```typescript
// Check if feature is enabled for a customer in a product
const isEnabled = await subscrio.featureChecker.isEnabledForCustomer(
  'customer-123',  // customerKey
  'my-saas',       // productKey
  'advanced-analytics'  // featureKey
);

// Get feature value for a customer in a product
const maxProjects = await subscrio.featureChecker.getValueForCustomer(
  'customer-123',  // customerKey
  'my-saas',       // productKey
  'max-projects'   // featureKey
);

// Get feature value for a specific subscription
const value = await subscrio.featureChecker.getValueForSubscription(
  'sub-001',       // subscriptionKey
  'max-projects'   // featureKey
);
```

## Hooks and Extensions

Each customer/subscription mutation emits `*.before` (mutable, can abort) and `*.after` (committed row, includes `entityId`). Stripe emits `stripe.received.before` / `.after` around `processStripeEvent`. Full TypeScript and .NET examples (tabbed) live in the reference docs:

- [Hooks](https://github.com/subscrio/docs/blob/main/docs/reference/hooks.md)
- [How to Extend](https://github.com/subscrio/docs/blob/main/docs/reference/how-to-extend.md) (includes audit-log and payments packaging examples)

```typescript
subscrio.hooks.on('customer.updated.before', async ({ old, new: next, source }) => {
  await audit.write({ old, new: next, source });
});

subscrio.hooks.on('customer.created.after', async ({ entityId, new: customer }) => {
  await notify.ready(entityId, customer);
});
```

## Stripe Integration

Subscrio accepts supported Stripe events after your application verifies them. Stripe remains responsible for payment processing. See the [Subscrio hub README](https://github.com/subscrio/subscrio#stripe-integration) for an overview.

**Important**: Subscrio does NOT verify Stripe webhook signatures. You must verify signatures before passing events to Subscrio.

```typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Process Stripe webhooks (implementor handles verification)
app.post('/webhooks/stripe', 
  express.raw({type: 'application/json'}), 
  async (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    
    try {
      // Verify webhook signature
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      
      // Process verified event
      await subscrio.stripe.processStripeEvent(event);
      res.json({received: true});
    } catch (err) {
      console.error('Webhook error:', err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);
```

### Create Stripe Subscription

```typescript
const subscription = await subscrio.stripe.createStripeSubscription(
  customer.key,
  plan.key,
  billingCycle.key,
  'price_123'
);
```

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import { 
  Subscrio, 
  SubscrioConfig,
  CreateProductDto, 
  ProductDto,
  CreateFeatureDto,
  FeatureDto,
  CreatePlanDto,
  PlanDto,
  CreateBillingCycleDto,
  BillingCycleDto,
  CreateCustomerDto,
  CustomerDto,
  CreateSubscriptionDto,
  SubscriptionDto
} from 'subscrio';

// All APIs are fully typed
const product: ProductDto = await subscrio.products.createProduct({
  key: 'my-product',
  displayName: 'My Product'
});
```

### Key Concepts

**Keys vs IDs**: All public APIs use **keys** (string identifiers like `'my-product'`) rather than internal IDs. Keys are:
- Human-readable and memorable
- Globally unique within their scope
- Immutable once created
- Used in all method calls and references

**DTOs**: All create/update operations use DTOs (Data Transfer Objects) with Zod validation:
- `CreateProductDto`, `CreateFeatureDto`, `CreatePlanDto`, etc.
- All fields are validated before processing
- Type-safe with full TypeScript inference

## Best Practices

1. **Schema Installation** - Run `installSchema()` once during application startup
2. **Error Handling** - Handle `ValidationError`, `NotFoundError`, `ConflictError` appropriately
3. **Feature Keys** - Use lowercase alphanumeric keys with hyphens (e.g., `max-projects`)
4. **Customer keys** - Use your own stable customer keys; set `externalBillingId` only when integrating with Stripe billing
5. **Database Connections** - Close connections with `subscrio.close()` when shutting down

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please open issues and pull requests in this repository. For org-wide contribution guidelines, see the [Subscrio hub CONTRIBUTING guide](https://github.com/subscrio/subscrio/blob/main/CONTRIBUTING.md).

## Support

- 📖 [Subscrio hub](https://github.com/subscrio/subscrio)
- 🐛 [Report Issues](https://github.com/subscrio/subscrio-typescript/issues)
- 💬 [Discussions](https://github.com/subscrio/subscrio/discussions) (org-wide)
- 📚 [Testing Guide](tests/README.md)
- 📋 [Core API reference](https://github.com/subscrio/docs/blob/main/docs/reference/core-overview.md)

<p align="center">
  Maintained by <a href="https://github.com/jasenf">Jasen Fici</a> · Part of the <a href="https://github.com/subscrio">Subscrio</a> org
</p>
