import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { DrizzleDb } from "./drizzle.js";
import {
  NotFoundError,
  ValidationError,
} from "../../application/errors/index.js";

// Raw rows remain internal; public services return explicit DTOs with string IDs.
export type Row = Record<string, any>;
export class DatabaseSession {
  constructor(readonly db: DrizzleDb) {}
  async rows<T extends Row = Row>(query: SQL): Promise<T[]> {
    return (await this.db.execute(query)).rows as T[];
  }
  async one(query: SQL): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }
  async require(query: SQL, label: string): Promise<Row> {
    const row = await this.one(query);
    if (!row) throw new NotFoundError(`${label} not found`);
    return row;
  }
  async transaction<T>(
    action: (store: DatabaseSession) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction((tx) =>
      action(new DatabaseSession(tx as unknown as DrizzleDb)),
    );
  }
  async lockCustomer(key: string): Promise<Row> {
    return this.require(
      sql`SELECT * FROM subscrio.customers WHERE key=${key} FOR UPDATE`,
      "Customer",
    );
  }
}
export function key(value: string, label = "key"): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,255}$/.test(value))
    throw new ValidationError(`Invalid ${label}`);
  return value;
}
export function idempotencyKey(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 255)
    throw new ValidationError(
      "idempotencyKey must contain 1 to 255 characters",
    );
  return value;
}
/** Versioned encoding shared with .NET: UTF-16 strings and IEEE-754 numbers avoid JSON formatting differences. */
export function fingerprint(value: unknown): string {
  const encodeString = (text: string) =>
    "s" +
    text.length +
    ":" +
    Array.from({ length: text.length }, (_, i) =>
      text.charCodeAt(i).toString(16).padStart(4, "0"),
    ).join("");
  function encode(v: any): string {
    if (v === null) return "z";
    if (typeof v === "string") return encodeString(v);
    if (typeof v === "boolean") return v ? "t" : "f";
    if (typeof v === "number") {
      const bytes = Buffer.alloc(8);
      bytes.writeDoubleBE(v === 0 ? 0 : v);
      return "n" + bytes.toString("hex");
    }
    if (Array.isArray(v)) return "a[" + v.map(encode).join("") + "]";
    return (
      "o{" +
      Object.keys(v)
        .sort()
        .map((k) => encodeString(k) + encode(v[k]))
        .join("") +
      "}"
    );
  }
  return createHash("sha256")
    .update("subscrio-request-v1:" + encode(JSON.parse(JSON.stringify(value))))
    .digest("hex");
}
export function paging(
  filter: { limit?: number; offset?: number } = {},
): [number, number] {
  const limit = filter.limit ?? 50,
    offset = filter.offset ?? 0;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 500 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new ValidationError("Invalid pagination");
  return [limit, offset];
}
export const iso = (v: Date | string): string => new Date(v).toISOString();
export function eligible(s: Row, at: Date): boolean {
  return (
    !s.is_archived &&
    (!s.activation_date || new Date(s.activation_date) <= at) &&
    (!s.cancellation_date || new Date(s.cancellation_date) > at) &&
    (!s.expiration_date || new Date(s.expiration_date) > at)
  );
}
