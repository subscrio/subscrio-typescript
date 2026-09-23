import { HookDispatcher } from "./HookDispatcher.js";
import type { AccountingMutationHookEvent, HookEventName } from "./types.js";
import { ValidationError } from "../errors/index.js";
import { afterCommit } from "../../infrastructure/database/transactionContext.js";

export type AccountingMutation =
  | "subscription.addonAttached"
  | "subscription.addonDetached"
  | "usage.reported"
  | "credit.consumed"
  | "credit.granted"
  | "credit.adjusted";
export class CommittedOperationHookError extends Error {
  constructor(
    public readonly result: unknown,
    cause: unknown,
  ) {
    super(
      "The operation committed, but its after-hook failed. Retry with the same idempotency key to retrieve the committed result.",
      { cause },
    );
    this.name = "CommittedOperationHookError";
  }
}
export class TransactionHooks {
  constructor(private readonly hooks: HookDispatcher = new HookDispatcher()) {}
  async before<T extends object>(
    mutation: AccountingMutation,
    input: T,
    permitted: string[],
  ): Promise<T> {
    const original = JSON.parse(JSON.stringify(input));
    const event: AccountingMutationHookEvent = {
      type: `${mutation}.before` as HookEventName,
      phase: "before",
      source: "api",
      occurredAt: new Date().toISOString(),
      input: structuredClone(original),
    };
    await this.hooks.emit(event.type as `${AccountingMutation}.before`, event);
    for (const k of new Set([
      ...Object.keys(original),
      ...Object.keys(event.input),
    ]))
      if (
        !permitted.includes(k) &&
        JSON.stringify(original[k]) !== JSON.stringify(event.input[k])
      )
        throw new ValidationError(`Hook cannot change ${k}`);
    return event.input as T;
  }
  async after(
    mutation: AccountingMutation,
    input: object,
    result: unknown,
  ): Promise<void> {
    const freeze = (value: any): any => {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
      return value;
    };
    const event = freeze({
      type: `${mutation}.after`,
      phase: "after",
      source: "api",
      occurredAt: new Date().toISOString(),
      input: JSON.parse(JSON.stringify(input)),
      result: structuredClone(result),
    }) as AccountingMutationHookEvent;
    await afterCommit(async () => {
      try {
        await this.hooks.emit(
          event.type as `${AccountingMutation}.after`,
          event,
        );
      } catch (error) {
        throw new CommittedOperationHookError(result, error);
      }
    });
  }
}
