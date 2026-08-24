# Subscrio Testing Guide

Complete guide for testing subscrio using end-to-end tests with real PostgreSQL databases.

## Philosophy

**We test the PUBLIC API with REAL databases. No mocks.**

- Test complete workflows end-to-end
- Each test suite gets a fresh PostgreSQL database
- Test actual behavior, not implementation details
- Focus on the public API that users will call

## Test Framework

**Vitest** - Fast, TypeScript-native testing framework

## Requirements

- **Local Development**: PostgreSQL 15+ installed and running
- **CI/CD**: Docker PostgreSQL container
- **Minimum Coverage**: 80% for all public API methods

## Quick Start

### 1. Install PostgreSQL

**macOS (Homebrew)**:
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Ubuntu/Debian**:
```bash
sudo apt-get install postgresql-15
sudo systemctl start postgresql
```

**Windows**:
Download from postgresql.org and install

### 2. Run Tests

```bash
cd typescript
npm test
```

This runs core e2e tests. Extension packages (`extensions/audit-log/typescript`, `extensions/payments/typescript`) have separate test suites in their own repositories. Use `npm run test:core` for core only, or run extension tests from each extension repo.

### 3. Watch Mode

```bash
npm run test:watch
```

### 4. Coverage Report

```bash
npm run test:coverage
```

### 5. Debug Mode (Keep Test Database)

```bash
npm run test:debug
```

This runs tests with `KEEP_TEST_DB=true` to preserve the test database for debugging.

## Test Structure

```
tests/
├── setup/
│   ├── database.ts              # Database creation/teardown utilities
│   ├── get-connection.ts        # Test database connection helper
│   ├── test-instance.ts         # Shared test instance management
│   ├── vitest-global-setup.ts   # Global setup (runs once)
│   └── vitest-setup.ts          # Per-test setup
└── e2e/
    ├── products.test.ts
    ├── features.test.ts
    ├── plans.test.ts
    ├── customers.test.ts
    ├── subscriptions.test.ts
    ├── billing-cycles.test.ts
    ├── feature-checker.test.ts    # CRITICAL - test resolution hierarchy
    └── stripe-integration.test.ts
```

## Database Setup Pattern

**Current Implementation**: Uses global setup with a shared test database for all tests.

Each test file follows this pattern:

```typescript
import { describe, test, expect, beforeAll } from 'vitest';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';

describe('Entity E2E Tests', () => {
  let subscrio: Subscrio;
  
  beforeAll(() => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });
  });

  test('does something', async () => {
    // Test using subscrio.* public API
  });
});
```

### Database Setup Architecture

**Global Setup** (`tests/setup/vitest-global-setup.ts`):
- Creates a single shared test database (`subscrio_test`)
- Runs once before all test files
- Handles cleanup of dangling test databases
- Sets up global test environment

**Per-Test Setup** (`tests/setup/vitest-setup.ts`):
- Runs before each test file
- Provides access to global test database
- Declares global TypeScript types

**Database Utilities** (`tests/setup/database.ts`):
- `setupTestDatabase()` - Creates shared test database
- `teardownTestDatabase()` - Cleans up test database
- `cleanupDanglingTestDatabases()` - Removes orphaned test databases
- Supports `KEEP_TEST_DB=true` for debugging

**Connection Helper** (`tests/setup/get-connection.ts`):
- Provides consistent test database connection string
- Uses `TEST_DATABASE_URL` environment variable
- Falls back to default PostgreSQL connection

## Public API Test Coverage

Every public method must have tests:

### Subscrio Main Class
- `new Subscrio(config)`
- `installSchema()`
- `verifySchema()`
- `dropSchema()`
- `close()`

### ProductManagementService (`subscrio.products`)
- `createProduct(dto)` - Create new product
- `updateProduct(key, dto)` - Update existing product
- `getProduct(key)` - Get product by key
- `listProducts(filters?)` - List products with optional filters
- `deleteProduct(key)` - Delete product (must be archived)
- `archiveProduct(key)` - Archive product
- `activateProduct(key)` - Activate product
- `associateFeature(productKey, featureKey)` - Associate feature with product
- `dissociateFeature(productKey, featureKey)` - Remove feature from product

### FeatureManagementService (`subscrio.features`)
- `createFeature(dto)` - Create new feature
- `updateFeature(key, dto)` - Update existing feature
- `getFeature(key)` - Get feature by key
- `listFeatures(filters?)` - List features with optional filters
- `deleteFeature(key)` - Delete feature (must be archived)
- `archiveFeature(key)` - Archive feature
- `unarchiveFeature(key)` - Unarchive feature
- `getFeaturesByProduct(productKey)` - Get features for a product

### PlanManagementService (`subscrio.plans`)
- `createPlan(dto)` - Create new plan
- `updatePlan(productKey, planKey, dto)` - Update existing plan
- `getPlan(productKey, planKey)` - Get plan by product and plan keys
- `listPlans(filters?)` - List plans with optional filters
- `getPlansByProduct(productKey)` - Get plans for a product
- `deletePlan(productKey, planKey)` - Delete plan (must be archived)
- `activatePlan(productKey, planKey)` - Activate plan
- `deactivatePlan(productKey, planKey)` - Deactivate plan
- `archivePlan(productKey, planKey)` - Archive plan
- `setFeatureValue(productKey, planKey, featureKey, value)` - Set feature value for plan
- `removeFeatureValue(productKey, planKey, featureKey)` - Remove feature value from plan
- `getFeatureValue(productKey, planKey, featureKey)` - Get feature value for plan
- `getPlanFeatures(productKey, planKey)` - Get all features for a plan

### CustomerManagementService (`subscrio.customers`)
- `createCustomer(dto)` - Create new customer
- `updateCustomer(key, dto)` - Update existing customer
- `getCustomer(key)` - Get customer by key
- `listCustomers(filters?)` - List customers with optional filters
- `archiveCustomer(key)` - Archive customer
- `unarchiveCustomer(key)` - Unarchive customer
- `deleteCustomer(key)` - Delete customer

### SubscriptionManagementService (`subscrio.subscriptions`)
- `createSubscription(dto)` - Create new subscription
- `updateSubscription(subscriptionKey, dto)` - Update existing subscription
- `getSubscription(subscriptionKey)` - Get subscription by key
- `getSubscriptionByStripeId(stripeId)` - Get subscription by Stripe ID
- `listSubscriptions(filters?)` - List subscriptions with optional filters
- `getSubscriptionsByCustomer(customerKey)` - Get all subscriptions for customer
- `getActiveSubscriptionsByCustomer(customerKey)` - Get active subscriptions for customer
- `cancelSubscription(subscriptionKey)` - Cancel subscription
- `expireSubscription(subscriptionKey)` - Expire subscription
- `renewSubscription(subscriptionKey)` - Renew subscription
- `deleteSubscription(subscriptionKey)` - Delete subscription
- `addFeatureOverride(subscriptionKey, featureKey, value, type)` - Add feature override
- `removeFeatureOverride(subscriptionKey, featureKey)` - Remove feature override
- `clearTemporaryOverrides(subscriptionKey)` - Clear temporary overrides

### BillingCycleManagementService (`subscrio.billingCycles`)
- `createBillingCycle(dto)` - Create new billing cycle
- `updateBillingCycle(productKey, planKey, key, dto)` - Update existing billing cycle
- `getBillingCycle(productKey, planKey, key)` - Get billing cycle
- `getBillingCyclesByPlan(productKey, planKey)` - Get billing cycles for plan
- `listBillingCycles(filters?)` - List billing cycles with optional filters
- `deleteBillingCycle(productKey, planKey, key)` - Delete billing cycle
- `getBillingCyclesByDurationUnit(durationUnit)` - Get billing cycles by duration
- `getDefaultBillingCycles()` - Get default billing cycles

### FeatureCheckerService (`subscrio.featureChecker`) - **CRITICAL**
- `getValueForCustomer(customerKey, productKey, featureKey, defaultValue?)` - Resolve a feature value for a customer on a product
- `isEnabledForCustomer(customerKey, productKey, featureKey)` - Check if a toggle feature is enabled
- `getAllFeaturesForCustomer(customerKey, productKey)` - Get all resolved feature values for a customer on a product
- `getValueForSubscription(subscriptionKey, featureKey, defaultValue?)` - Resolve a feature for one subscription
- `isEnabledForSubscription(subscriptionKey, featureKey)` - Check toggle feature on a subscription
- `getAllFeaturesForSubscription(subscriptionKey)` - Get all resolved features for a subscription
- `hasPlanAccess(customerKey, planKey)` - Check if customer has access to a plan
- `getActivePlans(customerKey)` - Get active plan keys for a customer
- `getFeatureUsageSummary(customerKey, productKey)` - Get feature usage summary

### StripeIntegrationService (`subscrio.stripe`)
- `processStripeEvent(event)` - Process verified Stripe webhook event
- `createStripeSubscription(customerKey, planKey, billingCycleKey, stripePriceId)` - Create Stripe subscription

## Example Test: Feature Resolution Hierarchy

This is the **most critical test** - it verifies the core feature resolution logic:

```typescript
describe('Feature Resolution Hierarchy', () => {
  test('resolves from subscription override > plan value > feature default', async () => {
    // 1. Create product
    const product = await subscrio.products.createProduct({
      key: 'test-product',
      displayName: 'Test Product'
    });

    // 2. Create feature with default value
    const feature = await subscrio.features.createFeature({
      key: 'max-projects',
      displayName: 'Max Projects',
      valueType: 'numeric',
      defaultValue: '10'
    });

    // 3. Associate feature with product
    await subscrio.products.associateFeature(product.key, feature.key);

    // 4. Create plan and set feature value
    const plan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: 'pro',
      displayName: 'Pro Plan'
    });
    await subscrio.plans.setFeatureValue(plan.key, feature.key, '50');

    const billingCycle = await subscrio.billingCycles.createBillingCycle({
      planKey: plan.key,
      key: 'monthly',
      displayName: 'Monthly',
      durationValue: 1,
      durationUnit: 'months'
    });

    // 5. Create customer
    const customer = await subscrio.customers.createCustomer({
      key: 'test-customer'
    });

    // 6. Create subscription
    const subscription = await subscrio.subscriptions.createSubscription({
      key: 'sub-001',
      customerKey: customer.key,
      billingCycleKey: billingCycle.key
    });

    // TEST: Should resolve from plan value
    let value = await subscrio.featureChecker.getValueForCustomer(
      customer.key,
      product.key,
      feature.key
    );
    expect(value).toBe('50');

    // 7. Add subscription override
    await subscrio.subscriptions.addFeatureOverride(
      subscription.key,
      feature.key,
      '100',
      'permanent'
    );

    // TEST: Should now resolve from subscription override
    value = await subscrio.featureChecker.getValueForCustomer(
      customer.key,
      product.key,
      feature.key
    );
    expect(value).toBe('100');

    // 8. Remove override
    await subscrio.subscriptions.removeFeatureOverride(subscription.key, feature.key);

    // TEST: Should fall back to plan value
    value = await subscrio.featureChecker.getValueForCustomer(
      customer.key,
      product.key,
      feature.key
    );
    expect(value).toBe('50');

    // 9. Remove plan feature value
    await subscrio.plans.removeFeatureValue(plan.key, feature.key);

    // TEST: Should fall back to feature default
    value = await subscrio.featureChecker.getValueForCustomer(
      customer.key,
      product.key,
      feature.key
    );
    expect(value).toBe('10');
  });
});
```

## Test Fixtures

Use the fixtures helper to create test data quickly:

**`tests/setup/fixtures.ts`:**
```typescript
import { Subscrio } from 'subscrio';

export class TestFixtures {
  constructor(private readonly subscrio: Subscrio) {}

  async createProduct(overrides = {}) {
    return this.subscrio.products.createProduct({
      key: `product-${Date.now()}`,
      displayName: 'Test Product',
      ...overrides
    });
  }

  async createFeature(overrides = {}) {
    return this.subscrio.features.createFeature({
      key: `feature-${Date.now()}`,
      displayName: 'Test Feature',
      valueType: 'toggle',
      defaultValue: 'false',
      ...overrides
    });
  }

  async createCustomer(overrides = {}) {
    return this.subscrio.customers.createCustomer({
      key: `customer-${Date.now()}`,
      ...overrides
    });
  }

  // Add more helpers as needed...
}
```

## Configuration

**`vitest.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./tests/setup/vitest-global-setup.ts'],
    setupFiles: ['./tests/setup/vitest-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.test.ts',
        '**/index.ts'
      ],
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80
    },
    poolOptions: {
      threads: {
        singleThread: true // Avoid DB conflicts
      }
    }
  }
});
```

**Available Test Scripts:**
- `npm test` - Run core tests, then first-party extension tests (`subscrio-audit-log`, `subscrio-payments`)
- `npm run test:core` - Run core tests only
- `npm run test:extensions` - Run first-party extension tests only
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report (then extension tests)
- `npm run test:debug` - Run tests with `KEEP_TEST_DB=true` for debugging

## CI/CD Integration

**GitHub Actions Example:**

```yaml
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:coverage
        env:
          TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/postgres
```

## Troubleshooting

### "Database does not exist"
```bash
createdb postgres
# Or set TEST_DATABASE_URL to an existing database
export TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
```

### "Connection refused"
- Ensure PostgreSQL is running: `brew services start postgresql@15` (macOS)
- Check PostgreSQL is listening on port 5432
- Verify credentials match your local setup

### "Permission denied to create database"
- Ensure your PostgreSQL user has CREATEDB privilege
- Run: `ALTER USER postgres CREATEDB;`

### Tests hang or timeout
- Check for unclosed database connections
- Global setup handles database creation/cleanup automatically
- Tests run sequentially (configured via `singleThread: true`)
- Use `npm run test:debug` to preserve test database for investigation

### "Too many connections"
- PostgreSQL may have connection limit reached
- Check active connections: `SELECT count(*) FROM pg_stat_activity;`
- Global setup includes cleanup of dangling test databases
- Terminate zombie connections from failed test runs

### Test Database Issues
- **Keep test database for debugging**: `KEEP_TEST_DB=true npm test`
- **Manual cleanup**: Connect to postgres and run `DROP DATABASE IF EXISTS subscrio_test;`
- **Check for orphaned databases**: Look for databases matching `subscrio_test_*` pattern
- **Global setup logs**: Check console output for database setup/teardown messages

### Environment Variables
- `TEST_DATABASE_URL` - Override default test database connection
- `KEEP_TEST_DB` - Set to `true` to preserve test database after tests
- `LOG_LEVEL` - Set to `error` during tests to reduce noise

## Best Practices

1. **Test Behavior, Not Implementation**
   - Call public API methods
   - Assert on outcomes
   - Don't test internal repository or domain service methods directly

2. **Use Real Data**
   - Don't mock the database
   - Use fixtures to create test data
   - Each test starts with a clean database

3. **Descriptive Test Names**
   ```typescript
   test('throws ConflictError when creating product with duplicate key', async () => {
     // ...
   });
   ```

4. **Test Error Cases**
   ```typescript
   await expect(
     subscrio.products.createProduct({ key: 'existing-key' })
   ).rejects.toThrow(ConflictError);
   ```

5. **Keep Tests Fast**
   - Run in parallel where possible
   - Use database transactions for faster cleanup (if needed)
   - Don't sleep/wait unnecessarily

6. **Cover All Public Methods**
   - Every method in `subscrio.*` namespace
   - Success paths
   - Error paths
   - Edge cases

## Monitoring Coverage

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/index.html  # macOS
xdg-open coverage/index.html  # Linux
start coverage/index.html  # Windows
```

**Target**: 80% minimum coverage for:
- Lines
- Functions
- Branches
- Statements

## Writing New Tests

When adding a new feature:

1. Add test file in `tests/e2e/`
2. Follow the database setup pattern
3. Test all public methods
4. Test success and error cases
5. Test business rule enforcement
6. Update this README if needed

**Example template:**
```typescript
import { describe, test, expect, beforeAll } from 'vitest';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';

describe('NewFeature E2E Tests', () => {
  let subscrio: Subscrio;
  
  beforeAll(() => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });
  });

  test('creates new thing successfully', async () => {
    const thing = await subscrio.things.createThing({
      name: 'Test Thing'
    });
    
    expect(thing).toBeDefined();
    expect(thing.name).toBe('Test Thing');
  });

  test('throws ValidationError for invalid data', async () => {
    await expect(
      subscrio.things.createThing({ name: '' })
    ).rejects.toThrow('ValidationError');
  });
});
```

## Support

- See [README.md](../README.md) for project setup
- See [Subscrio documentation](https://github.com/subscrio/docs) for specifications
- Run `npm run test:watch` for interactive testing during development

