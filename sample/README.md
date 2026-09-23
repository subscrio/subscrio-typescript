# Subscrio Customer Lifecycle Demo

A comprehensive demonstration of the Subscrio subscription management library through a realistic customer journey scenario.

## Scenario

This demo simulates **ProjectHub**, a project management SaaS platform with:

- **Multiple tiers**: Free, Starter, Professional, Enterprise
- **Feature-based access control**: Project limits, user limits, premium features
- **Flexible billing**: Monthly and annual cycles
- **Dynamic overrides**: Temporary and permanent feature customizations

## What You'll Learn

This demo walks through a complete customer lifecycle:

1. **System Setup**: Initialize database, create products, features, and plans
2. **Customer Onboarding**: Create customer and trial subscription
3. **Feature Resolution**: Multiple methods to check feature access
4. **Feature Overrides**: Temporary overrides for special cases
5. **Plan Upgrades**: Transition between plans
6. **Expiration Handling**: What happens when subscriptions expire
7. **Multiple Subscriptions**: How features resolve with multiple active plans

## Prerequisites

- Node.js 20.19+ or compatible runtime
- PostgreSQL database (local or remote)
- npm package manager

## Setup

1. **Create a PostgreSQL database**:
   ```bash
   createdb subscrio_demo
   ```

2. **Configure environment**:
   ```bash
   cd typescript/sample
   cp env.example .env
   # Edit .env with your database connection string
   ```

3. **Install dependencies**:
   ```bash
   cd typescript/sample
   npm install
   ```
   
   **Note:** The sample imports the core library directly via relative path (`../src/index.js`), making it fully portable with no symlinks.

## Running the Demo

From the `sample/` directory in this repository:

```bash
# Standard mode (runs continuously)
npm start

# Force schema recreation before running
npm start -- --recreate

# Interactive mode (pauses after each step for database inspection)
npm start -- --interactive
# or
npm start -- -i
```

Or using the watch mode for development:

```bash
npm run dev
```

## What to Expect

The demo will:

1. **Show cleanup warning** - Lists all entities that will be created
2. **Wait for confirmation** - Press ENTER to continue or Ctrl+C to cancel
3. Create all necessary database tables
4. Set up a complete product with features and plans
5. Walk through a customer's journey from trial to enterprise
6. Demonstrate feature resolution hierarchy
7. Show various ways to check feature access
8. Display formatted output at each step
9. **Show cleanup reminder** - Lists all entities created for manual cleanup

**Runtime**: Approximately 10-15 seconds with pauses for readability.

## Interactive Mode

When using `--interactive` or `-i` flag, the demo will:

1. **Pause after key steps** - Allow you to inspect the database state
2. **Show inspection prompts** - Clear indication of what just happened
3. **Wait for user input** - Press ENTER to continue to the next step
4. **Display current phase/step** - Always know where you are in the demo

This is perfect for:
- **Learning the API** - See exactly what data is created at each step
- **Debugging** - Inspect database state when things go wrong
- **Understanding** - Follow the data flow through the system
- **Development** - Test your own queries between demo steps

### Interactive Mode Example

```
🔍 INTERACTIVE MODE
══════════════════════════════════════════════════
Phase: Phase 1: System Setup
Step: Step 1: Database Schema

You can now:
  • Check your database directly
  • Run SQL queries to inspect data
  • Use database tools to explore entities
  • Examine the current state before continuing

When ready, press ENTER to continue to the next step...
```

## Database Cleanup

The demo creates specific entities with these keys:

- **Products**: `projecthub`
- **Features**: `max-projects`, `max-users-per-project`, `gantt-charts`, `custom-branding`, `api-access`
- **Plans**: `free`, `starter`, `professional`, `enterprise`
- **Billing Cycles**: `monthly`, `annual` (for each paid plan)
- **Customers**: `acme-corp`
- **Subscriptions**: `acme-starter-trial`, `acme-free`, `acme-enterprise`

**Important**: Clean up these entities after the demo to avoid conflicts in future runs.

## Output Format

The demo produces structured, educational output:

```
═══════════════════════════════════════════════════════════
  PHASE 1: System Initialization & Product Setup
═══════════════════════════════════════════════════════════

┌─ Step 1: Initialize Database Schema
│
│ ✓ Database schema installed successfully
│
└───────────────────────────────────────────────────────────

...
```

## Key Concepts Demonstrated

### Creating a subscription

Supply a subscription key, customer key, and billing-cycle key. The billing cycle determines the plan and product.

```typescript
await subscrio.subscriptions.createSubscription({
  key: 'acme-starter',
  customerKey: 'acme-corp',
  billingCycleKey: 'starter-monthly'
});
```

### Feature Resolution Hierarchy

The demo clearly shows how Subscrio resolves feature values:

1. **Subscription Override** (highest priority)
   - Temporary: Cleared on renewal
   - Permanent: Persists through renewals
2. **Plan Value**
   - Defined per plan
3. **Feature Default** (fallback)
   - Used when no subscription or plan value exists

### Multiple Subscription Handling

Customers can have multiple active subscriptions. The demo shows:
- How features are resolved across subscriptions
- Override precedence with multiple subscriptions
- Real-world scenarios (e.g., team-specific enterprise plan)

### API Methods Showcased

- `products.createProduct()`
- `features.createFeature()`
- `plans.createPlan()`
- `plans.setFeatureValue()`
- `customers.createCustomer()`
- `subscriptions.createSubscription()` (requires key, customerKey and billingCycleKey)
- `subscriptions.addFeatureOverride()`
- `featureChecker.getValueForCustomer()`
- `featureChecker.getAllFeaturesForCustomer()`
- `featureChecker.getFeatureUsageSummary()`

## Customization

Feel free to modify the demo to explore different scenarios:

- Change feature types (toggle, numeric, text)
- Add more plans or features
- Experiment with different override strategies
- Test plan transitions and renewals

## Troubleshooting

### Database Connection Error

```
ERROR: DATABASE_URL environment variable is required
```

**Solution**: Create a `.env` file with your database connection string.

### Schema Already Exists

The demo checks if the schema exists and won't reinstall it. To start fresh:

```sql
-- Only in a disposable database: use the sample --recreate option.
-- Subscrio uses the subscrio schema.
```

### Full Schema Reset While Running the Sample

Pass `--recreate` (or `-r`) when launching the script to drop and reinstall every Subscrio table automatically:

```bash
npm start -- --recreate
```

The flag invokes `subscrio.dropSchema()` before Phase 1, then immediately runs `subscrio.installSchema()` as part of the normal flow. Combine it with `--interactive` if needed, or fall back to the manual SQL above if you prefer handling the schema yourself.

### Permission Errors

Ensure your PostgreSQL user has permissions to:
- Create tables
- Insert/update/delete data
- Create indexes

## Next Steps

After running the demo:

1. Review the source code in `index.ts` to understand the API
2. Check the [core API reference](https://github.com/subscrio/docs/blob/main/docs/reference/core-overview.md) for complete documentation
3. Explore the [test suite](../tests/e2e/) for more examples
4. Build your own subscription management system!

## Support

For questions or issues:
- Check the [package README](../README.md)
- Review the [Subscrio docs](https://github.com/subscrio/docs)
- Examine the [test examples](../tests/e2e/)


## Asserted catalog and accounting walkthrough

After the original lifecycle scenario, the console demonstrates add-on quantities and composition, timed override expiry, hard and soft metered quotas, idempotent retries, shared credit spending, recurring grants, cancellation and ledger reconciliation. Each displayed result is asserted; success ends with `CAPABILITIES DEMO VERIFIED`. It uses a fixed adjustable clock and unique catalog keys. Run against a disposable database; retained accounting history intentionally prevents destructive cleanup of reused customers.
