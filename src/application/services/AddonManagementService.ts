import { sql } from "drizzle-orm";
import {
  DatabaseSession,
  key,
  paging,
  iso,
  type Row,
} from "../../infrastructure/database/DatabaseSession.js";
import { ValidationError, ConflictError } from "../errors/index.js";
import { FeatureValueValidator } from "../utils/FeatureValueValidator.js";
import type {
  AddonDto,
  UpdateAddonDto,
  CreateAddonDto,
} from "../dtos/AddonDto.js";
import type { PageFilter } from "../dtos/PaginationDto.js";

export class AddonManagementService {
  constructor(private readonly store: DatabaseSession) {}
  private async dto(r: Row, store = this.store): Promise<AddonDto> {
    return {
      featureValues: Object.fromEntries(
        (
          await store.rows(
            sql`SELECT f.key,af.value FROM subscrio.addon_features af JOIN subscrio.features f ON f.id=af.feature_id WHERE af.addon_id=${r.id} ORDER BY f.key`,
          )
        ).map((x) => [x.key, x.value]),
      ),
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
    };
  }
  async createAddon(input: CreateAddonDto): Promise<AddonDto> {
    key(input.key);
    this.validate(input);
    return this.store.transaction(async (st) => {
      const p = await st.require(
        sql`SELECT * FROM subscrio.products WHERE key=${input.productKey} AND status='active' FOR UPDATE`,
        "Active product",
      );
      if (
        await st.one(sql`SELECT id FROM subscrio.addons WHERE key=${input.key}`)
      )
        throw new ConflictError("Addon key already exists");
      await st.rows(
        sql`INSERT INTO subscrio.addons(product_id,key,display_name,description,composition_mode,priority,metadata) VALUES(${p.id},${input.key},${input.displayName},${input.description ?? null},${input.compositionMode ?? "additive"},${input.priority ?? 0},${JSON.stringify(input.metadata ?? null)}::jsonb)`,
      );
      await this.saveFeatureValues(st, input.key, input.featureValues);
      return this.dto(
        await st.require(
          sql`SELECT a.*,p.key product_key FROM subscrio.addons a JOIN subscrio.products p ON p.id=a.product_id WHERE a.key=${input.key}`,
          "Addon",
        ),
        st,
      );
    });
  }
  private validate(
    input: Partial<Omit<CreateAddonDto, "featureValues">>,
  ): void {
    if (
      input.displayName !== undefined &&
      (!input.displayName.trim() || input.displayName.length > 255)
    )
      throw new ValidationError(
        "Display name is required and must be at most 255 characters",
      );
    if (
      input.compositionMode !== undefined &&
      !["additive", "override"].includes(input.compositionMode)
    )
      throw new ValidationError("Invalid composition mode");
    if (
      input.priority !== undefined &&
      (!Number.isInteger(input.priority) ||
        Math.abs(input.priority) > 2147483647)
    )
      throw new ValidationError("Invalid priority");
  }
  async updateAddon(
    addonKey: string,
    input: UpdateAddonDto,
  ): Promise<AddonDto> {
    this.validate(input);
    return this.store.transaction(async (st) => {
      const a = await st.require(
        sql`SELECT * FROM subscrio.addons WHERE key=${addonKey} FOR UPDATE`,
        "Addon",
      );
      if (
        input.compositionMode === "override" &&
        (await st.one(
          sql`SELECT id FROM subscrio.subscription_addons WHERE addon_id=${a.id} AND quantity<>1 AND status='active'`,
        ))
      )
        throw new ConflictError("Replacement addons require quantity one");
      await st.rows(
        sql`UPDATE subscrio.addons SET display_name=${input.displayName ?? a.display_name},description=${input.description ?? a.description},composition_mode=${input.compositionMode ?? a.composition_mode},priority=${input.priority ?? a.priority},metadata=${JSON.stringify(input.metadata ?? a.metadata)}::jsonb,updated_at=NOW() WHERE id=${a.id}`,
      );
      await this.saveFeatureValues(st, addonKey, input.featureValues);
      return this.dto(
        await st.require(
          sql`SELECT a.*,p.key product_key FROM subscrio.addons a JOIN subscrio.products p ON p.id=a.product_id WHERE a.id=${a.id}`,
          "Addon",
        ),
        st,
      );
    });
  }
  async getAddon(addonKey: string): Promise<AddonDto | null> {
    const r = await this.store.one(
      sql`SELECT a.*,p.key product_key FROM subscrio.addons a JOIN subscrio.products p ON p.id=a.product_id WHERE a.key=${addonKey}`,
    );
    return r ? this.dto(r) : null;
  }
  async listAddons(
    productKey: string,
    filter: PageFilter = {},
  ): Promise<AddonDto[]> {
    const [limit, offset] = paging(filter);
    return Promise.all(
      (
        await this.store.rows(
          sql`SELECT a.*,p.key product_key FROM subscrio.addons a JOIN subscrio.products p ON p.id=a.product_id WHERE p.key=${productKey} AND (${filter.status ?? null}::text IS NULL OR a.status=${filter.status ?? null}) AND (${filter.search ?? null}::text IS NULL OR a.key ILIKE ${"%" + (filter.search ?? "") + "%"}) ORDER BY a.key LIMIT ${limit} OFFSET ${offset}`,
        )
      ).map((r) => this.dto(r)),
    );
  }
  async archiveAddon(k: string): Promise<void> {
    await this.status(k, "archived");
  }
  async unarchiveAddon(k: string): Promise<void> {
    await this.status(k, "active");
  }
  private async status(k: string, status: string): Promise<void> {
    await this.store.require(
      sql`UPDATE subscrio.addons SET status=${status},updated_at=NOW() WHERE key=${k} RETURNING id`,
      "Addon",
    );
  }
  async deleteAddon(k: string): Promise<void> {
    await this.store.transaction(async (st) => {
      const a = await st.require(
        sql`SELECT * FROM subscrio.addons WHERE key=${k} FOR UPDATE`,
        "Addon",
      );
      if (
        a.status !== "archived" ||
        (await st.one(
          sql`SELECT id FROM subscrio.subscription_addons WHERE addon_id=${a.id}`,
        ))
      )
        throw new ConflictError(
          "Only archived addons without attachment history can be deleted",
        );
      await st.rows(
        sql`DELETE FROM subscrio.addon_features WHERE addon_id=${a.id}`,
      );
      await st.rows(sql`DELETE FROM subscrio.addons WHERE id=${a.id}`);
    });
  }
  private async saveFeatureValues(
    st: DatabaseSession,
    addonKey: string,
    values?: Record<string, string | null>,
  ): Promise<void> {
    if (values === undefined) return;
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw new ValidationError("featureValues must be a map");
    const addon = await st.require(
      sql`SELECT id,product_id FROM subscrio.addons WHERE key=${addonKey}`,
      "Addon",
    );
    for (const [featureKey, value] of Object.entries(values)) {
      const feature = await st.require(
        sql`SELECT f.* FROM subscrio.features f JOIN subscrio.product_features pf ON pf.feature_id=f.id WHERE f.key=${featureKey} AND pf.product_id=${addon.product_id}`,
        "Associated feature",
      );
      if (value === null)
        await st.rows(
          sql`DELETE FROM subscrio.addon_features WHERE addon_id=${addon.id} AND feature_id=${feature.id}`,
        );
      else {
        if (typeof value !== "string")
          throw new ValidationError("Addon feature values must be strings");
        FeatureValueValidator.validate(value, feature.value_type);
        await st.rows(
          sql`INSERT INTO subscrio.addon_features(addon_id,feature_id,value) VALUES(${addon.id},${feature.id},${value}) ON CONFLICT(addon_id,feature_id) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
        );
      }
    }
  }
}
