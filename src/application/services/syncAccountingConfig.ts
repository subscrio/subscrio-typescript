import { loadAllPages } from "../utils/PagedListLoader.js";
import type { Subscrio } from "../../Subscrio.js";
import type { ConfigSyncDto, ConfigSyncReport } from "../dtos/ConfigSyncDto.js";
import { OverrideType } from "../../domain/value-objects/OverrideType.js";

export async function syncAccountingConfig(
  app: Subscrio,
  config: ConfigSyncDto,
  report: ConfigSyncReport,
): Promise<void> {
  async function apply(key: string, action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      report.errors.push({
        entityType: "entitlement",
        key,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  for (const currency of config.creditCurrencies ?? [])
    await apply(currency.key, async () => {
      if (await app.credits.getCurrency(currency.key))
        await app.credits.updateCurrency(currency.key, currency);
      else await app.credits.createCurrency(currency);
      if (currency.archived !== undefined)
        await (currency.archived
          ? app.credits.archiveCurrency(currency.key)
          : app.credits.unarchiveCurrency(currency.key));
    });
  if (config.creditConsumptionRules !== undefined) {
    const featureKeys = new Set([
      ...(
        await loadAllPages((offset, limit) =>
          app.features.listFeatures({ offset, limit }),
        )
      ).map((f) => f.key),
      ...config.creditConsumptionRules.map((r) => r.featureKey),
    ]);
    for (const featureKey of featureKeys)
      await apply(featureKey, async () => {
        const desired = config.creditConsumptionRules!.filter(
          (r) => r.featureKey === featureKey,
        );
        for (const old of await app.credits.listConsumptionRules(featureKey))
          if (!desired.some((r) => r.currencyKey === old.currencyKey))
            await app.credits.removeConsumptionRule(
              featureKey,
              old.currencyKey,
            );
        for (const rule of desired)
          await app.credits.setConsumptionRule(
            featureKey,
            rule.currencyKey,
            rule.creditsPerUnit,
          );
      });
  }
  for (const feature of config.features) {
    if (feature.meteredConfig)
      await apply(feature.key, () =>
        app.features.updateFeature(feature.key, {
          meteredConfig: feature.meteredConfig!,
        }),
      );
    if (feature.creditConsumptionRules !== undefined)
      await apply(feature.key, async () => {
        for (const old of await app.credits.listConsumptionRules(feature.key))
          if (
            !feature.creditConsumptionRules!.some(
              (r) => r.currencyKey === old.currencyKey,
            )
          )
            await app.credits.removeConsumptionRule(
              feature.key,
              old.currencyKey,
            );
        for (const rule of feature.creditConsumptionRules!)
          await app.credits.setConsumptionRule(
            feature.key,
            rule.currencyKey,
            rule.creditsPerUnit,
          );
      });
  }
  for (const product of config.products) {
    for (const [featureKey, policy] of Object.entries(
      product.featureResolution ?? {},
    ))
      await apply(product.key, () =>
        app.products.associateFeature(product.key, featureKey, policy),
      );
    for (const addon of product.addons ?? [])
      await apply(addon.key, async () => {
        if (await app.addons.getAddon(addon.key)) {
          const old = await app.addons.getAddon(addon.key);
          if (old?.productKey !== product.key)
            throw new Error("Addon product cannot change");
          await app.addons.updateAddon(addon.key, addon);
        } else
          await app.addons.createAddon({ ...addon, productKey: product.key });
        if (addon.featureValues !== undefined) {
          for (const f of Object.keys(
            (await app.addons.getAddon(addon.key))!.featureValues,
          ))
            if (!(f in addon.featureValues))
              await app.addons.updateAddon(addon.key, {
                featureValues: { [f]: null },
              });
          for (const [f, value] of Object.entries(addon.featureValues))
            await app.addons.updateAddon(addon.key, {
              featureValues: { [f]: value },
            });
        }
        if (addon.archived !== undefined)
          await (addon.archived
            ? app.addons.archiveAddon(addon.key)
            : app.addons.unarchiveAddon(addon.key));
      });
    for (const plan of product.plans ?? [])
      if (plan.creditGrants !== undefined)
        await apply(plan.key, async () => {
          for (const old of await app.credits.listPlanGrants(plan.key))
            if (
              !plan.creditGrants!.some((g) => g.currencyKey === old.currencyKey)
            )
              await app.credits.removePlanGrant(plan.key, old.currencyKey);
          for (const grant of plan.creditGrants!)
            await app.credits.setPlanGrant(plan.key, grant.currencyKey, grant);
        });
  }
  for (const sub of config.subscriptions ?? [])
    await apply(sub.key, async () => {
      const existing = await app.subscriptions.getSubscription(sub.key);
      if (!existing)
        throw new Error("Config sync only updates existing subscriptions");
      for (const override of sub.featureOverrides) {
        if (override.remove) {
          await app.subscriptions.removeFeatureOverride(
            sub.key,
            override.featureKey,
          );
          continue;
        }
        const old = existing.featureOverrides?.find(
          (o) => o.featureKey === override.featureKey,
        );
        if (
          old &&
          old.type === override.type &&
          old.value === override.value &&
          (old.expiresAt ?? null) ===
            (override.expiresAt
              ? new Date(override.expiresAt).toISOString()
              : null)
        )
          continue;
        await app.subscriptions.addFeatureOverride(
          sub.key,
          override.featureKey,
          override.value,
          override.type as OverrideType,
          override.expiresAt,
        );
      }
    });
}
