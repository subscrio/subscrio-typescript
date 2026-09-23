import { SubscriptionAddonManager } from "./application/services/SubscriptionAddonManager.js";
import { CatalogReader } from "./infrastructure/repositories/CatalogReader.js";
import { ProductFeatureRepository } from "./infrastructure/repositories/ProductFeatureRepository.js";
import { sql } from "drizzle-orm";
import { TransactionHooks } from "./application/hooks/TransactionHooks.js";
import { DatabaseSession } from "./infrastructure/database/DatabaseSession.js";
import { FeatureResolutionQuery } from "./application/services/FeatureResolutionQuery.js";
import { AddonManagementService } from "./application/services/AddonManagementService.js";
import { MeteringService } from "./application/services/MeteringService.js";
import { CreditManagementService } from "./application/services/CreditManagementService.js";
import type { SubscrioConfig, InitialConfigSync } from "./config/types.js";
import type { ConfigSyncReport } from "./application/dtos/ConfigSyncDto.js";
import {
  initializeDatabase,
  DrizzleDb,
  closeDatabase,
} from "./infrastructure/database/drizzle.js";
import { SchemaInstaller } from "./infrastructure/database/installer.js";
import { detectDatabaseDialect } from "./infrastructure/database/dialect.js";

// Repositories
import { IProductRepository } from "./application/repositories/IProductRepository.js";
import { IFeatureRepository } from "./application/repositories/IFeatureRepository.js";
import { IPlanRepository } from "./application/repositories/IPlanRepository.js";
import { ICustomerRepository } from "./application/repositories/ICustomerRepository.js";
import { ISubscriptionRepository } from "./application/repositories/ISubscriptionRepository.js";
import { IBillingCycleRepository } from "./application/repositories/IBillingCycleRepository.js";

// Repository implementations
import { DrizzleProductRepository } from "./infrastructure/repositories/DrizzleProductRepository.js";
import { DrizzleFeatureRepository } from "./infrastructure/repositories/DrizzleFeatureRepository.js";
import { DrizzlePlanRepository } from "./infrastructure/repositories/DrizzlePlanRepository.js";
import { DrizzleCustomerRepository } from "./infrastructure/repositories/DrizzleCustomerRepository.js";
import { DrizzleSubscriptionRepository } from "./infrastructure/repositories/DrizzleSubscriptionRepository.js";
import { DrizzleBillingCycleRepository } from "./infrastructure/repositories/DrizzleBillingCycleRepository.js";

// Services
import { ProductManagementService } from "./application/services/ProductManagementService.js";
import { FeatureManagementService } from "./application/services/FeatureManagementService.js";
import { PlanManagementService } from "./application/services/PlanManagementService.js";
import { CustomerManagementService } from "./application/services/CustomerManagementService.js";
import { SubscriptionManagementService } from "./application/services/SubscriptionManagementService.js";
import { BillingCycleManagementService } from "./application/services/BillingCycleManagementService.js";
import { FeatureCheckerService } from "./application/services/FeatureCheckerService.js";
import { StripeIntegrationService } from "./application/services/StripeIntegrationService.js";
import { ConfigSyncService } from "./application/services/ConfigSyncService.js";
import { HookDispatcher } from "./application/hooks/HookDispatcher.js";

// Domain services
// FeatureValueResolver is instantiated within FeatureCheckerService

/**
 * Main Subscrio class - entry point for the library
 */
export class Subscrio {
  private readonly db: DrizzleDb;
  private readonly installer: SchemaInstaller;
  private readonly _initialConfig?: InitialConfigSync;
  private readonly adminPassphrase?: string;

  // Repositories (private)
  private readonly productRepo: IProductRepository;
  private readonly featureRepo: IFeatureRepository;
  private readonly planRepo: IPlanRepository;
  private readonly customerRepo: ICustomerRepository;
  private readonly subscriptionRepo: ISubscriptionRepository;
  private readonly billingCycleRepo: IBillingCycleRepository;

  // Public services
  public readonly addons: AddonManagementService;
  public readonly metering: MeteringService;
  public readonly credits: CreditManagementService;
  public readonly products: ProductManagementService;
  public readonly features: FeatureManagementService;
  public readonly plans: PlanManagementService;
  public readonly customers: CustomerManagementService;
  public readonly subscriptions: SubscriptionManagementService;
  public readonly billingCycles: BillingCycleManagementService;
  public readonly featureChecker: FeatureCheckerService;
  public readonly stripe: StripeIntegrationService;
  public readonly configSync: ConfigSyncService;
  /** Before-mutation hooks for customers, subscriptions, and inbound Stripe events */
  public readonly hooks: HookDispatcher;

  constructor(config: SubscrioConfig) {
    // Initialize database
    this.db = initializeDatabase(config.database);
    this.installer = new SchemaInstaller(
      this.db,
      config.database.databaseType ??
        detectDatabaseDialect(config.database.connectionString),
    );
    this.hooks = new HookDispatcher(config.hooks);
    this.adminPassphrase = config.adminPassphrase;

    // Initialize repositories
    this.productRepo = new DrizzleProductRepository(this.db);
    this.featureRepo = new DrizzleFeatureRepository(this.db);
    this.planRepo = new DrizzlePlanRepository(this.db);
    this.customerRepo = new DrizzleCustomerRepository(this.db);
    this.subscriptionRepo = new DrizzleSubscriptionRepository(this.db);
    this.billingCycleRepo = new DrizzleBillingCycleRepository(this.db);

    // Initialize domain services
    // FeatureValueResolver is instantiated within FeatureCheckerService

    const databaseSession = new DatabaseSession(this.db);
    const catalog = new CatalogReader(databaseSession);
    const resolutionQuery = new FeatureResolutionQuery(databaseSession, config.clock);
    const mutationHooks = new TransactionHooks(this.hooks);
    this.addons = new AddonManagementService(databaseSession);
    this.metering = new MeteringService(
      databaseSession,
      config.clock,
      mutationHooks,
    );
    this.credits = new CreditManagementService(
      databaseSession,
      config.clock,
      mutationHooks,
    );
    (this.subscriptionRepo as DrizzleSubscriptionRepository).coordinateSave =
      async (subscription, save) =>
        databaseSession.transaction(async (st) => {
          const customer = await st.require(
            sql`SELECT key FROM subscrio.customers WHERE id=${subscription.customerId}`,
            "Customer",
          );
          await st.lockCustomer(customer.key);
          await this.credits.prepareSubscriptionChange(
            customer.key,
            subscription.key,
            subscription.isArchived,
            subscription.props.cancellationDate,
            subscription.props.expirationDate,
          );
          const saved = await save();
          await this.credits.processScheduledGrants(customer.key);
          return saved;
        });
    // Initialize application services
    this.products = new ProductManagementService(
      this.productRepo,
      this.featureRepo,
      new ProductFeatureRepository(databaseSession),
      catalog,
    );
    this.features = new FeatureManagementService(
      this.featureRepo,
      this.productRepo,
      catalog,
    );
    this.plans = new PlanManagementService(
      this.planRepo,
      this.productRepo,
      this.featureRepo,
      this.subscriptionRepo,
      catalog,
    );
    this.customers = new CustomerManagementService(
      this.customerRepo,
      this.hooks,
    );
    this.subscriptions = new SubscriptionManagementService(
      this.subscriptionRepo,
      this.customerRepo,
      this.planRepo,
      this.billingCycleRepo,
      this.featureRepo,
      this.productRepo,
      this.hooks,
      config.clock,
      catalog,
    );
    this.billingCycles = new BillingCycleManagementService(
      this.billingCycleRepo,
      this.planRepo,
      this.subscriptionRepo,
    );
    this.featureChecker = new FeatureCheckerService(
      this.subscriptionRepo,
      this.planRepo,
      this.featureRepo,
      this.customerRepo,
      this.productRepo,
      resolutionQuery,
    );
    this.subscriptions.addonService = new SubscriptionAddonManager(
      databaseSession,
      mutationHooks,
    );
    this.stripe = new StripeIntegrationService(
      this.subscriptionRepo,
      this.customerRepo,
      this.planRepo,
      this.billingCycleRepo,
      config, // Pass config for Stripe secret key access
      this.hooks,
    );
    this.configSync = new ConfigSyncService(this, config.clock);
    this._initialConfig = config.initialConfig;
  }

  /**
   * Run initial config sync if initialConfig was provided to the constructor.
   * Call this after construction (e.g. after installSchema/verifySchema) to apply the config.
   * @returns The sync report, or null if no initialConfig was set
   */
  async runInitialConfigSync(): Promise<ConfigSyncReport | null> {
    if (!this._initialConfig) return null;
    if (this._initialConfig.type === "file") {
      return await this.configSync.syncFromFile(this._initialConfig.filePath);
    }
    return await this.configSync.syncFromJson(this._initialConfig.config);
  }

  /**
   * Install database schema
   */
  async installSchema(adminPassphrase?: string): Promise<void> {
    await this.installer.install(adminPassphrase ?? this.adminPassphrase);
  }

  /**
   * Verify schema installation
   * Returns the schema version if installed, null otherwise
   */
  async verifySchema(): Promise<string | null> {
    return await this.installer.verify();
  }

  /**
   * Run pending database migrations
   *
   * Migrations are tracked via schema_version in system_config.
   * This method runs only pending migrations and updates the version.
   *
   * @returns Number of migrations applied
   */
  async migrate(): Promise<number> {
    return await this.installer.migrate();
  }

  /**
   * Drop all database tables (WARNING: Destructive!).
   * When an admin passphrase hash exists, the passphrase must match.
   */
  async dropSchema(adminPassphrase?: string): Promise<void> {
    await this.installer.dropAll(adminPassphrase ?? this.adminPassphrase);
  }

  /**
   * Close database connections
   */
  async close(): Promise<void> {
    await closeDatabase();
  }
}
