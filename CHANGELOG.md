# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-09-23

### Added

- Product add-ons with feature values, subscription quantities, and additive or replacement behavior.
- Rules for combining plan and add-on values within a subscription and allowances across subscriptions, with diagnostic explanations.
- Metered features with calendar or billing-period resets, hard and soft limits, usage history, and idempotent reporting.
- Customer credit wallets with grants, feature consumption costs, scheduled plan grants, expiration, and a transaction ledger.
- Timed subscription feature overrides that stop applying at their expiration time.
- Schema migrations through version 1.4.0, including historical-upgrade and cross-language accounting verification.

### Changed

- Feature, product, plan, and subscription results include their related add-on data.
- Feature create/update includes metered configuration; product-feature association accepts value calculation rules.
- Configuration sync and export include add-ons, metering settings, credit rules, and subscription overrides.
- Hooks cover add-on attachments, usage reporting, and credit operations. Console demos cover the new capabilities.

### Upgrade

- Back up existing databases and run `subscrio.migrate()` before using the new capabilities. Upgrade applications sharing a database together.
- Existing product-feature associations retain their previous value-selection behavior. Explicitly configure additive rules when enabling extra-capacity add-ons.
- This is a core-only release. Extension and integration packages are not released at 0.5.0; their existing compatibility ranges still apply.

## [0.4.0] - 2026-09-20

### Added

- SQL Server dialect SQL for schema install, migration, verification, and removal. The TypeScript query runtime remains PostgreSQL-only.
- Stripe webhook signature verification through `constructStripeEvent` and `stripe.webhookSecret`.
- Explicit clear operations for subscription trial dates and plan expiration transitions.
- Subscription feature overrides in returned subscription DTOs.
- Typed feature-value conversion through the exported `convertFeatureValue` helper.
- Admin-passphrase verification before destructive schema removal.
- Stripe received hooks now include optional customer and subscription IDs extracted from the verified event.

### Changed

- Configuration sync now loads every page instead of stopping after the first 100 records.
- Feature resolution evaluates all eligible subscriptions before falling back to plan or feature defaults.
- List queries apply a stable order before offset and limit.
- Stripe processing fails closed for unknown subscription states and no longer treats the placeholder subscription helper as a real Stripe create operation.
- The audit-log and payments peer dependency range for this release is `>=0.4.0 <0.5.0`.

### Fixed

- Feature type changes are persisted during updates.
- Plan feature values must belong to the plan's product.
- Before-hook mutations are validated again before customer and subscription records are saved.
- Expiration transitions create the replacement subscription before archiving the old one.
- Schema verification now distinguishes a missing schema from an unexpected database error.
- Connection strings are redacted before they are written to logs.
- The `subscrio-migrate` executable now points to compiled JavaScript included in the npm package.

### Compatibility

- Repository interfaces no longer expose the unused `exists` methods. Consumers that implement these exported interfaces must remove those members when upgrading.

## [0.3.1] - 2026-09-11

### Added

- `clearTrialEndDate` on subscription updates so omitted trial dates no longer clear trials
- `clearOnExpireTransitionToBillingCycleKey` on plan updates and ConfigSync
- `constructStripeEvent` webhook signature helper
- Feature overrides on subscription DTOs
- Dual-dialect schema SQL (PostgreSQL + SQL Server) for install, view, migrate, and drop
- Admin passphrase enforcement on destructive schema drop
- OSS files: SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, .editorconfig

### Changed

- ConfigSync pages all entities instead of the first 100
- FeatureChecker multi-subscription resolution no longer locks onto the first plan default
- `getActivePlans` and usage summary count only active/trial (product-scoped for usage)
- `hasPlanAccess` requires the plan to belong to the given product
- Typed feature values convert from stored strings using the provided default's type
- List queries apply order then offset then limit
- Expire transitions create the replacement subscription before archiving
- Stripe unknown statuses fail closed
- `createStripeSubscription` is not a real Stripe create API

### Fixed

- Feature `valueType` is persisted on update
- Plan feature values require product association
- Toggle create validation is case-insensitive
- Schema verify rethrows unexpected errors instead of treating them as "not installed"
- SSL=true requires TLS with certificate verification
- Hooks re-validate customer and subscription DTOs after before-hook mutations

## [0.3.0] - 2026-08-19

### Changed
- npm packages are now unscoped: install `subscrio`, `subscrio-audit-log`, and `subscrio-payments` (previously `@saas-experts/subscrio`, `@saas-experts/subscrio-audit-log`, and `@saas-experts/subscrio-payments`). Update imports to match.
- Repository metadata now points at `https://github.com/subscrio/subscrio`.
- NuGet `<Authors>` is `Subscrio` (was `Saas Experts Co`) on `Subscrio.Core`, `Subscrio.AuditLog`, and `Subscrio.Payments`.
- Stripe integration uses API version `2026-07-29.dahlia` (TypeScript `stripe` ^22, .NET Stripe.net 52). Invoice subscription and price IDs are read from Stripe's nested invoice parent and pricing fields.
- Subscription billing periods are taken from the matching Stripe subscription item instead of the subscription object.
- TypeScript requires Node.js 20.19 or later.
- TypeScript dependencies updated, including Zod 4 and Drizzle ORM 0.45.
- .NET dependencies updated, including Entity Framework Core, FluentValidation 12, Stripe.net 52, and System.Text.Json.

### Fixed
- `invoice.payment_succeeded` handling, payment tracking, and audit-log Stripe mapping now resolve subscription IDs after Stripe moved them off the top-level invoice object.
- Test database fallbacks no longer hardcode a local Postgres password; they use the same `postgres:postgres` default as core, overridden by `TEST_DATABASE_URL`.

## [0.2.4] - 2026-08-06

### Changed
- Audit-log Stripe event handling now extracts and resolves customer and subscription IDs from the event payload so `customer_id`, `subscription_id`, and related keys are populated when possible (TypeScript and .NET)
- 
## [0.2.3] - 2026-08-06

### Changed
- Added repository, homepage, bugs, and keywords metadata to the `@saas-experts/subscrio-audit-log` package for clearer npm/GitHub linking

## [0.2.2] - 2026-08-05

### Changed
- Version bump only; no user-facing API or behavior changes

## [0.2.1] - 2026-08-05

### Added
- Before and after hooks for customer and subscription create, update, archive, and delete
- First-party audit-log extensions for TypeScript (`@saas-experts/subscrio-audit-log`) and .NET that persist transaction rows to Postgres via `*.after` hooks
- Hook documentation for extending Subscrio with custom mutation logic

### Changed
- Customer and subscription DTOs are mutable so before-hooks can apply in-place modifications
- Stripe integration emits hooks for relevant Stripe-driven customer and subscription events

## [0.2.0] - 2026-08-05

### Added
- Before-mutation hooks for customer and subscription management (create, update, archive, delete) in TypeScript and .NET
- Initial configuration sync from a file or JSON on construction
- .NET dependency injection support via `AddSubscrio`, including optional automatic initial config sync during service registration
- Hooks emitted from Stripe integration for auditing and custom event handling


## [0.1.16] - 2025-12-17

### Added
- Enhanced Stripe integration with subscription linking and checkout session creation
- `isArchived` property to `SubscriptionDto` for better subscription state tracking
- Customer object and `isArchived` filter to subscription queries for improved filtering capabilities

### Changed
- Improved Stripe subscription period and metadata handling for more reliable synchronization
- Clarified Stripe Checkout session parameter usage in documentation

### Fixed
- 


## [0.1.15] - 2025-11-21

### Fixed
- Enhanced validation for `onExpireTransitionToBillingCycleKey` to ensure the referenced billing cycle exists across all plans within the same product, preventing invalid transition configurations

### Changed
- Enhanced subscription lifecycle documentation with comprehensive trial scenarios and best practices, including detailed guidance on trial end behaviors and billing period configuration

## [0.1.14] - 2025-11-19

### Added
- 

### Changed
- 

### Fixed
- 


## [0.1.13] - 2025-11-19

### Added
- Database migration functionality for managing schema changes
- Subscription transition handling when subscriptions expire, allowing automatic transitions to specified billing cycles
- Schema updates to support subscription expiration transitions

### Fixed
- Validation for `onExpireTransitionToBillingCycleKey` parameter in subscription management to prevent invalid transitions


## [0.1.13] - 2025-01-27

### Added
- Database migration functionality for managing schema changes
- Subscription transition handling when subscriptions expire, allowing automatic transitions to specified billing cycles
- Schema updates to support subscription expiration transitions

### Fixed
- Validation for `onExpireTransitionToBillingCycleKey` parameter in subscription management to prevent invalid transitions

## [0.1.12] - 2025-11-17

### Added
- 

### Changed
- Moved tables to their own schema

### Fixed
- 


## [0.1.11] - 2025-11-17

### Added
- ConfigSyncDto and ConfigSyncService integration into Subscrio for configuration synchronization

### Changed
- Updated Vite configuration to include additional external dependencies

### Removed
- CONFIG_SYNC.md documentation file

## [0.1.10] - 2025-11-15

### Added
- Automatic Stripe customer synchronization and broader event mapping coverage, plus refreshed integration docs to clarify setup end to end.
- Modular core API reference documentation and a rewritten getting started guide to accelerate onboarding.

### Changed
- Standardized all reference content into modular service files with consistent formatting, including expanded TypeScript service guidance and refined billing cycle docs.

### Removed
- API key management feature and its supporting documentation, reflecting the streamlined direct-import architecture.
- Legacy monolithic documentation directory, replaced by the new reference structure.

## [0.1.9] - 2025-11-13

### Changed

* Standardized entities and repositories to use numeric IDs internally for more consistent type handling.
* Refactored repository ID handling and removed redundant checks to simplify the code and reduce edge-case failures.
* Updated API documentation to reference public keys instead of internal IDs where appropriate, clarifying how clients should interact with the API.
* Updated `package.json` metadata and scripts in preparation for the 0.1.9 release.


All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - 2025-11-13

### Added
- Archived state for customers and subscriptions with filtering and deletion enforcement
- Status enums and database column for billing cycles
- Shared utilities for feature validation, time handling, and constants
- Base repository and service abstractions with environment config helpers
- Audit report document with findings and remediation plan
- Expanded README, API reference, and demo scripts
- MIT license, `.npmignore`, and npm metadata updates

### Changed
- Renamed package from `@subscrio/core` to `@saas-experts/subscrio`
- Removed `inactive` status; use `archived` instead
- Prevent deletion of entities with associations or active subscriptions
- Made keys and foreign-key identifiers immutable in update DTOs
- Switched to `npm` and improved CLI output
- Optimized feature checks and plan lookups with caching

### Deprecated
- None.

### Removed
- Legacy code paths and deprecated assets from published package
- Manual SQL sanitization helpers; using Drizzle's parameterized queries
- `inactive` status value from DTOs and docs

### Fixed
- Hardened deletion and association rules to prevent orphaned states
- Improved test coverage for subscriptions, features, and SQL injection

### Security
- Strengthened SQL injection defenses with parameterized queries

## [0.1.0] - 2024-12-19

### Added
- Initial release of @subscrio/core TypeScript library
- Complete subscription management system with feature flags
- PostgreSQL integration with Drizzle ORM
- Stripe webhook processing and integration
- Feature resolution hierarchy (subscription overrides → plan values → defaults)
- Comprehensive TypeScript type definitions
- ESM and CommonJS dual package support
- Full test suite with E2E testing

### Features
- **Product Management**: Create and manage subscription products
- **Feature Flags**: Granular feature control with numeric, toggle, and text values
- **Plan Management**: Flexible subscription plans with feature value overrides
- **Customer Management**: Customer lifecycle and external ID mapping
- **Subscription Lifecycle**: Complete subscription management from trial to renewal
- **Billing Cycles**: Flexible billing periods (monthly, annual, custom)
- **Feature Resolution**: Smart hierarchy for determining feature access
- **Stripe Integration**: Webhook processing and payment synchronization
- **TypeScript Support**: Full type safety and excellent developer experience

### Technical Details
- Built with TypeScript 5.0+
- Uses Drizzle ORM for database operations
- Supports PostgreSQL 12+
- Node.js 18+ required
- MIT License
