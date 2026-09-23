import { AsyncLocalStorage } from "node:async_hooks";
import type { DrizzleDb } from "./drizzle.js";

const context = new AsyncLocalStorage<{
  db: DrizzleDb;
  root: DrizzleDb;
  afterCommit: Array<() => Promise<void>>;
}>();
export async function afterCommit(work: () => Promise<void>): Promise<void> {
  const current = context.getStore();
  if (current) current.afterCommit.push(work);
  else await work();
}
/** Existing repositories and accounting share one transaction during lifecycle changes. */
export function transactionalDatabase(db: DrizzleDb): DrizzleDb {
  return new Proxy(db, {
    get(target, property) {
      const active = context.getStore();
      const current = active?.root === target ? active : undefined;
      if (property === "transaction")
        return async <T>(work: (tx: DrizzleDb) => Promise<T>): Promise<T> => {
          if (current) return work(current.db);
          const callbacks: Array<() => Promise<void>> = [];
          const result = await target.transaction((tx) =>
            context.run(
              {
                db: tx as unknown as DrizzleDb,
                root: target,
                afterCommit: callbacks,
              },
              () => work(tx as unknown as DrizzleDb),
            ),
          );
          for (const callback of callbacks) await callback();
          return result;
        };
      const owner = current?.db ?? target,
        value = Reflect.get(owner, property);
      return typeof value === "function" ? value.bind(owner) : value;
    },
  });
}
