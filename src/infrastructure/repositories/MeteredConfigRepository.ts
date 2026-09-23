import { sql } from "drizzle-orm";
import { DatabaseSession } from "../database/DatabaseSession.js";
import {
  MeteredConfigSchema,
  type MeteredFeatureConfigDto,
} from "../../application/dtos/MeteringDto.js";
import { ValidationError } from "../../application/errors/index.js";
export class MeteredConfigRepository {
  constructor(private readonly store: DatabaseSession) {}
  async setMeteredConfig(
    featureKey: string,
    config: MeteredFeatureConfigDto,
  ): Promise<void> {
    const parsed = MeteredConfigSchema.safeParse(config);
    if (!parsed.success)
      throw new ValidationError(
        "Invalid metered configuration",
        parsed.error.issues,
      );
    await this.store.transaction(async (st) => {
      const f = await st.require(
        sql`SELECT * FROM subscrio.features WHERE key=${featureKey} FOR UPDATE`,
        "Feature",
      );
      if (f.value_type !== "metered")
        throw new ValidationError(
          "Meter configuration requires metered feature type",
        );
      const old = await st.one(
        sql`SELECT * FROM subscrio.metered_feature_config WHERE feature_id=${f.id}`,
      );
      if (
        old &&
        (old.scope !== config.usageScope ||
          old.reset_period !== config.resetPeriod ||
          old.aggregation !== config.aggregation) &&
        (await st.one(
          sql`SELECT id FROM subscrio.usage_events WHERE feature_id=${f.id} LIMIT 1`,
        ))
      )
        throw new ValidationError(
          "Scope, reset period and aggregation cannot change after usage has been recorded",
        );
      await st.rows(
        sql`INSERT INTO subscrio.metered_feature_config(feature_id,reset_period,enforcement,aggregation,scope) VALUES(${f.id},${config.resetPeriod},${config.enforcement},${config.aggregation},${config.usageScope}) ON CONFLICT(feature_id) DO UPDATE SET reset_period=EXCLUDED.reset_period,enforcement=EXCLUDED.enforcement,aggregation=EXCLUDED.aggregation,scope=EXCLUDED.scope,updated_at=NOW()`,
      );
    });
  }
  async getMeteredConfig(k: string): Promise<MeteredFeatureConfigDto | null> {
    const r = await this.store.one(
      sql`SELECT m.* FROM subscrio.metered_feature_config m JOIN subscrio.features f ON f.id=m.feature_id WHERE f.key=${k}`,
    );
    return r
      ? {
          resetPeriod: r.reset_period,
          enforcement: r.enforcement,
          aggregation: r.aggregation,
          usageScope: r.scope,
        }
      : null;
  }
}
