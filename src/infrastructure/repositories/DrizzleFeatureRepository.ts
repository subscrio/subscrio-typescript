import { accountingDelete } from "../database/accountingDelete.js";
import { DatabaseSession } from "../database/DatabaseSession.js";
import { MeteredConfigRepository } from "./MeteredConfigRepository.js";
import { ValidationError } from "../../application/errors/index.js";
import { sql } from "drizzle-orm";
import { IFeatureRepository } from "../../application/repositories/IFeatureRepository.js";
import { Feature } from "../../domain/entities/Feature.js";
import { FeatureMapper } from "../../application/mappers/FeatureMapper.js";
import { DrizzleDb } from "../database/drizzle.js";
import {
  features,
  product_features,
  plan_features,
  subscription_feature_overrides,
} from "../database/schema.js";
import { eq, and, like, or, desc, asc, inArray } from "drizzle-orm";
import { FeatureFilterDto } from "../../application/dtos/FeatureDto.js";
import { applyPaging } from "./applyPaging.js";

export class DrizzleFeatureRepository implements IFeatureRepository {
  constructor(private readonly db: DrizzleDb) {}

  async save(feature: Feature): Promise<Feature> {
    if (feature.valueType === "metered" && !feature.props.meteredConfig)
      throw new ValidationError("Metered features require meteredConfig");
    if (feature.valueType !== "metered" && feature.props.meteredConfig)
      throw new ValidationError("Only metered features accept meteredConfig");
    return this.db.transaction(async (tx) => {
      const repository = new DrizzleFeatureRepository(
        tx as unknown as DrizzleDb,
      );
      if (feature.id !== undefined) {
        const [old] = await tx
          .select()
          .from(features)
          .where(eq(features.id, feature.id))
          .for("update");
        if (old?.value_type !== feature.valueType) {
          const used = await tx.execute(
            sql`SELECT id FROM subscrio.usage_events WHERE feature_id=${feature.id} LIMIT 1`,
          );
          if (used.rows.length)
            throw new ValidationError(
              "Cannot change feature type after usage is recorded",
            );
        }
      }
      if (feature.id !== undefined && feature.valueType === "metered") {
        const rules = await tx.execute(
          sql`SELECT id FROM subscrio.credit_consumption_rules WHERE feature_id=${feature.id} LIMIT 1`,
        );
        if (rules.rows.length)
          throw new ValidationError(
            "Remove credit consumption rules before changing to metered",
          );
      }
      if (feature.id !== undefined && feature.valueType === "text")
        await tx.execute(
          sql`UPDATE subscrio.product_features SET composition_rule='override_wins',cross_subscription_rule=CASE WHEN cross_subscription_rule='legacy' THEN 'legacy' ELSE 'override_wins' END WHERE feature_id=${feature.id}`,
        );
      const saved = await repository.saveRecord(feature);
      if (saved.props.meteredConfig)
        await new MeteredConfigRepository(
          new DatabaseSession(tx as unknown as DrizzleDb),
        ).setMeteredConfig(saved.key, saved.props.meteredConfig);
      return saved;
    });
  }
  private async hydrate(record: any): Promise<Feature> {
    const feature = FeatureMapper.toDomain(record);
    if (feature.valueType === "metered")
      feature.props.meteredConfig =
        (await new MeteredConfigRepository(
          new DatabaseSession(this.db),
        ).getMeteredConfig(feature.key)) ?? undefined;
    return feature;
  }
  private async saveRecord(feature: Feature): Promise<Feature> {
    const record = FeatureMapper.toPersistence(feature);

    if (feature.id === undefined) {
      // Insert new entity
      const [inserted] = await this.db
        .insert(features)
        .values(record)
        .returning({ id: features.id });

      // Update entity with generated ID
      return new Feature(feature.props, inserted.id);
    } else {
      // Update existing entity
      await this.db
        .update(features)
        .set({
          key: record.key,
          display_name: record.display_name,
          description: record.description,
          value_type: record.value_type,
          default_value: record.default_value,
          group_name: record.group_name,
          status: record.status,
          validator: record.validator,
          metadata: record.metadata,
          updated_at: record.updated_at,
        })
        .where(eq(features.id, feature.id));

      return feature;
    }
  }

  async findById(id: number): Promise<Feature | null> {
    const [record] = await this.db
      .select()
      .from(features)
      .where(eq(features.id, id))
      .limit(1);

    return record ? this.hydrate(record) : null;
  }

  async findByKey(key: string): Promise<Feature | null> {
    const [record] = await this.db
      .select()
      .from(features)
      .where(eq(features.key, key))
      .limit(1);

    return record ? this.hydrate(record) : null;
  }

  async findAll(filters?: FeatureFilterDto): Promise<Feature[]> {
    let query = this.db.select().from(features);

    if (filters) {
      const conditions = [];

      if (filters.status) {
        conditions.push(eq(features.status, filters.status));
      }

      if (filters.valueType) {
        conditions.push(eq(features.value_type, filters.valueType));
      }

      if (filters.groupName) {
        conditions.push(eq(features.group_name, filters.groupName));
      }

      if (filters.search) {
        // Drizzle handles parameterized queries automatically - no manual sanitization needed
        conditions.push(
          or(
            like(features.key, `%${filters.search}%`),
            like(features.display_name, `%${filters.search}%`),
            like(features.description, `%${filters.search}%`),
          ),
        );
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }

      // Apply sorting
      const sortBy = filters.sortBy || "createdAt";
      const sortOrder = filters.sortOrder || "asc";

      if (sortBy === "displayName") {
        query = query.orderBy(
          sortOrder === "desc"
            ? desc(features.display_name)
            : asc(features.display_name),
        ) as typeof query;
      } else {
        query = query.orderBy(
          sortOrder === "desc"
            ? desc(features.created_at)
            : asc(features.created_at),
        ) as typeof query;
      }

      query = applyPaging(query, filters.offset, filters.limit) as typeof query;
    } else {
      query = query.orderBy(asc(features.created_at)) as typeof query;
    }

    const records = await query;
    return Promise.all(records.map((r) => this.hydrate(r)));
  }

  async findByIds(ids: number[]): Promise<Feature[]> {
    if (ids.length === 0) return [];

    const records = await this.db
      .select()
      .from(features)
      .where(inArray(features.id, ids));

    return Promise.all(records.map((r) => this.hydrate(r)));
  }

  async findByProduct(productId: number): Promise<Feature[]> {
    const records = await this.db
      .select({
        id: features.id,
        key: features.key,
        display_name: features.display_name,
        description: features.description,
        value_type: features.value_type,
        default_value: features.default_value,
        group_name: features.group_name,
        status: features.status,
        validator: features.validator,
        metadata: features.metadata,
        created_at: features.created_at,
        updated_at: features.updated_at,
      })
      .from(features)
      .innerJoin(product_features, eq(features.id, product_features.feature_id))
      .where(eq(product_features.product_id, productId))
      .orderBy(asc(features.created_at));

    return Promise.all(records.map((r) => this.hydrate(r)));
  }

  async delete(id: number): Promise<void> {
    await accountingDelete(async () => {
      await this.db.delete(features).where(eq(features.id, id));
    });
  }

  async hasProductAssociations(featureId: number): Promise<boolean> {
    const [record] = await this.db
      .select({ id: product_features.id })
      .from(product_features)
      .where(eq(product_features.feature_id, featureId))
      .limit(1);

    return !!record;
  }

  async hasPlanFeatureValues(featureId: number): Promise<boolean> {
    const [record] = await this.db
      .select({ id: plan_features.id })
      .from(plan_features)
      .where(eq(plan_features.feature_id, featureId))
      .limit(1);

    return !!record;
  }

  async hasSubscriptionOverrides(featureId: number): Promise<boolean> {
    const [record] = await this.db
      .select({ id: subscription_feature_overrides.id })
      .from(subscription_feature_overrides)
      .where(eq(subscription_feature_overrides.feature_id, featureId))
      .limit(1);

    return !!record;
  }
}
