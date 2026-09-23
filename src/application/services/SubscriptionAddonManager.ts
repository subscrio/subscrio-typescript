import { CatalogReader } from "../../infrastructure/repositories/CatalogReader.js";
import { TransactionHooks } from "../hooks/TransactionHooks.js";
import { sql } from "drizzle-orm";
import {
  DatabaseSession,
  paging,
} from "../../infrastructure/database/DatabaseSession.js";
import { ValidationError } from "../errors/index.js";
import { safeAmount } from "../../domain/services/AccountingArithmetic.js";
import type { SubscriptionAddonDto } from "../dtos/AddonDto.js";
import type { PageFilter } from "../dtos/PaginationDto.js";

/** @internal */
export class SubscriptionAddonManager {
  constructor(
    private readonly store: DatabaseSession,
    private readonly mutationHooks: TransactionHooks,
  ) {}
  async attachAddon(
    subscriptionKey: string,
    addonKey: string,
    quantity = 1,
  ): Promise<SubscriptionAddonDto> {
    const proposed = await this.mutationHooks.before(
      "subscription.addonAttached",
      { subscriptionKey, addonKey, quantity },
      ["quantity"],
    );
    quantity = proposed.quantity;
    safeAmount(quantity, "quantity", 1);
    if (quantity > 2147483647)
      throw new ValidationError("Quantity exceeds storage limit");
    await this.store.transaction(async (st) => {
      const owner = await st.require(
        sql`SELECT c.key FROM subscrio.customers c JOIN subscrio.subscriptions s ON s.customer_id=c.id WHERE s.key=${subscriptionKey}`,
        "Subscription customer",
      );
      await st.lockCustomer(owner.key);
      const s = await st.require(
        sql`SELECT s.*,p.product_id FROM subscrio.subscriptions s JOIN subscrio.plans p ON p.id=s.plan_id WHERE s.key=${subscriptionKey} FOR UPDATE OF s`,
        "Subscription",
      );
      const a = await st.require(
        sql`SELECT * FROM subscrio.addons WHERE key=${addonKey} FOR UPDATE`,
        "Addon",
      );
      if (
        s.is_archived ||
        a.status !== "active" ||
        s.product_id !== a.product_id
      )
        throw new ValidationError(
          "Addon must be active and belong to the subscription product; subscription must not be archived",
        );
      if (a.composition_mode === "override" && quantity !== 1)
        throw new ValidationError("Replacement addons require quantity one");
      await st.rows(
        sql`INSERT INTO subscrio.subscription_addons(subscription_id,addon_id,quantity) VALUES(${s.id},${a.id},${quantity}) ON CONFLICT(subscription_id,addon_id) DO UPDATE SET quantity=EXCLUDED.quantity,status='active',updated_at=NOW()`,
      );
    });
    await this.mutationHooks.after(
      "subscription.addonAttached",
      { subscriptionKey, addonKey, quantity },
      { subscriptionKey, addonKey, quantity, status: "active" },
    );
    return (
      await new CatalogReader(this.store).subscriptionAddons(subscriptionKey)
    ).find((a) => a.addonKey === addonKey)!;
  }
  async detachAddon(s: string, a: string): Promise<void> {
    await this.mutationHooks.before(
      "subscription.addonDetached",
      { subscriptionKey: s, addonKey: a },
      [],
    );
    await this.store.transaction(async (st) => {
      const owner = await st.require(
        sql`SELECT c.key FROM subscrio.customers c JOIN subscrio.subscriptions sub ON sub.customer_id=c.id WHERE sub.key=${s}`,
        "Subscription customer",
      );
      await st.lockCustomer(owner.key);
      await st.require(
        sql`UPDATE subscrio.subscription_addons SET status='cancelled',updated_at=NOW() WHERE subscription_id=(SELECT id FROM subscrio.subscriptions WHERE key=${s}) AND addon_id=(SELECT id FROM subscrio.addons WHERE key=${a}) RETURNING id`,
        "Attachment",
      );
    });
    await this.mutationHooks.after(
      "subscription.addonDetached",
      { subscriptionKey: s, addonKey: a },
      { subscriptionKey: s, addonKey: a, status: "cancelled" },
    );
  }
  async listSubscriptionAddons(
    subscriptionKey: string,
    filter: PageFilter = {},
  ): Promise<SubscriptionAddonDto[]> {
    const [limit, offset] = paging(filter);
    return (
      await new CatalogReader(this.store).subscriptionAddons(subscriptionKey)
    ).slice(offset, offset + limit);
  }
}
