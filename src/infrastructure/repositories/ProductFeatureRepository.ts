import { sql } from "drizzle-orm";
import { DatabaseSession } from "../database/DatabaseSession.js";
import { ValidationError } from "../../application/errors/index.js";
import type { FeatureResolutionOptions } from "../../application/dtos/FeatureResolutionDto.js";
export class ProductFeatureRepository {
  constructor(private readonly store: DatabaseSession) {}
  async associate(
    productKey: string,
    featureKey: string,
    options?: FeatureResolutionOptions,
  ): Promise<void> {
    await this.store.transaction(async (st) => {
      const product = await st.require(
        sql`SELECT id FROM subscrio.products WHERE key=${productKey}`,
        "Product",
      );
      const feature = await st.require(
        sql`SELECT id,value_type FROM subscrio.features WHERE key=${featureKey}`,
        "Feature",
      );
      const old = await st.one(
        sql`SELECT * FROM subscrio.product_features WHERE product_id=${product.id} AND feature_id=${feature.id}`,
      );
      const addonRule =
        options?.addonRule ??
        old?.composition_rule ??
        (feature.value_type === "text"
          ? "override_wins"
          : feature.value_type === "toggle"
            ? "most_generous"
            : "additive");
      const subscriptionRule = options
        ? (options.subscriptionRule ?? "legacy")
        : (old?.cross_subscription_rule ?? "legacy");
      const rules = ["additive", "most_generous", "override_wins"];
      if (
        !rules.includes(addonRule) ||
        (options?.subscriptionRule != null &&
          !rules.includes(options.subscriptionRule))
      )
        throw new ValidationError("Invalid feature resolution rule");
      if (
        feature.value_type === "text" &&
        (addonRule !== "override_wins" ||
          !["legacy", "override_wins"].includes(subscriptionRule))
      )
        throw new ValidationError("Text features require override_wins");
      await st.rows(
        sql`INSERT INTO subscrio.product_features(product_id,feature_id,composition_rule,cross_subscription_rule) VALUES(${product.id},${feature.id},${addonRule},${subscriptionRule}) ON CONFLICT(product_id,feature_id) DO UPDATE SET composition_rule=EXCLUDED.composition_rule,cross_subscription_rule=EXCLUDED.cross_subscription_rule`,
      );
    });
  }
}
