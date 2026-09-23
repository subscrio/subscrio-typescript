import { sql } from "drizzle-orm";
import { DatabaseSession, iso } from "../database/DatabaseSession.js";
import type {
  AddonDto,
  SubscriptionAddonDto,
} from "../../application/dtos/AddonDto.js";
import type { FeatureResolutionOptions } from "../../application/dtos/FeatureResolutionDto.js";
export class CatalogReader {
  constructor(private readonly store: DatabaseSession) {}
  async addons(productKey?: string, featureKey?: string): Promise<AddonDto[]> {
    const rows = await this.store.rows(
      sql`SELECT a.*,p.key product_key FROM subscrio.addons a JOIN subscrio.products p ON p.id=a.product_id WHERE (${productKey ?? null}::text IS NULL OR p.key=${productKey ?? null}) AND (${featureKey ?? null}::text IS NULL OR EXISTS(SELECT 1 FROM subscrio.addon_features af JOIN subscrio.features f ON f.id=af.feature_id WHERE af.addon_id=a.id AND f.key=${featureKey ?? null})) ORDER BY a.key`,
    );
    if (!rows.length) return [];
    const values = await this.store.rows(
      sql`SELECT af.addon_id,f.key,af.value FROM subscrio.addon_features af JOIN subscrio.features f ON f.id=af.feature_id WHERE af.addon_id IN (${sql.join(
        rows.map((r) => sql`${r.id}`),
        sql`,`,
      )})`,
    );
    return rows.map((r) => ({
      key: r.key,
      productKey: r.product_key,
      displayName: r.display_name,
      description: r.description,
      compositionMode: r.composition_mode,
      priority: r.priority,
      status: r.status,
      metadata: r.metadata,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      featureValues: Object.fromEntries(
        values.filter((v) => v.addon_id === r.id).map((v) => [v.key, v.value]),
      ),
    }));
  }
  async subscriptionAddons(
    subscriptionKey: string,
  ): Promise<SubscriptionAddonDto[]> {
    const rows = await this.store.rows(
      sql`SELECT sa.*,s.key subscription_key,a.key addon_key,p.key product_key FROM subscrio.subscription_addons sa JOIN subscrio.subscriptions s ON s.id=sa.subscription_id JOIN subscrio.addons a ON a.id=sa.addon_id JOIN subscrio.products p ON p.id=a.product_id WHERE s.key=${subscriptionKey} ORDER BY a.key`,
    );
    if (!rows.length) return [];
    const catalog = await this.addons(rows[0].product_key);
    return rows.map((r) => ({
      subscriptionKey: r.subscription_key,
      addonKey: r.addon_key,
      quantity: r.quantity,
      status: r.status,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      addon: catalog.find((a) => a.key === r.addon_key)!,
    }));
  }
  async productFeatures(
    productKey: string,
  ): Promise<
    Array<{ featureKey: string; resolution: FeatureResolutionOptions }>
  > {
    return (
      await this.store.rows(
        sql`SELECT f.key,pf.composition_rule,pf.cross_subscription_rule FROM subscrio.product_features pf JOIN subscrio.products p ON p.id=pf.product_id JOIN subscrio.features f ON f.id=pf.feature_id WHERE p.key=${productKey} ORDER BY f.key`,
      )
    ).map((r) => ({
      featureKey: r.key,
      resolution: {
        addonRule: r.composition_rule,
        subscriptionRule:
          r.cross_subscription_rule === "legacy"
            ? undefined
            : r.cross_subscription_rule,
      },
    }));
  }
}
