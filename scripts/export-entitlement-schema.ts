import { writeFileSync, mkdirSync } from "node:fs";
import {
  ENTITLEMENT_MIGRATIONS,
  entitlementMigrationSql,
} from "../src/infrastructure/database/entitlementMigrations.js";
const target = new URL(
  "../../dotnet/src/Infrastructure/Database/EntitlementMigrations/",
  import.meta.url,
);
mkdirSync(target, { recursive: true });
for (const dialect of ["postgres", "sqlserver"] as const) {
  writeFileSync(
    new URL(`${dialect}.json`, target),
    JSON.stringify(
      Object.fromEntries(
        Object.keys(ENTITLEMENT_MIGRATIONS).map((version) => [
          version,
          entitlementMigrationSql(version, dialect),
        ]),
      ),
      null,
      2,
    ) + "\n",
  );
}
