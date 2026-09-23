import { ValidationError } from "../../application/errors/index.js";
import type { MeteredFeatureConfigDto } from "../../application/dtos/MeteringDto.js";

export function safeAmount(
  value: unknown,
  name = "amount",
  minimum = 0,
): number {
  const n =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < minimum)
    throw new ValidationError(`${name} must be a safe integer >= ${minimum}`);
  return n;
}
export function utcDate(value: Date | string, name = "date"): Date {
  if (typeof value === "string" && !/(Z|[+-]\d\d:\d\d)$/i.test(value))
    throw new ValidationError(`${name} must include a timezone`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new ValidationError(`Invalid ${name}`);
  return date;
}
export function calendarPeriod(
  now: Date,
  period: MeteredFeatureConfigDto["resetPeriod"],
): [Date, Date] {
  const start = new Date(now);
  start.setUTCMilliseconds(0);
  start.setUTCSeconds(0);
  start.setUTCMinutes(0);
  if (period !== "hourly") start.setUTCHours(0);
  if (period === "weekly")
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period === "monthly" || period === "yearly") start.setUTCDate(1);
  if (period === "yearly") start.setUTCMonth(0);
  const end = new Date(start);
  switch (period) {
    case "hourly":
      end.setUTCHours(end.getUTCHours() + 1);
      break;
    case "daily":
      end.setUTCDate(end.getUTCDate() + 1);
      break;
    case "weekly":
      end.setUTCDate(end.getUTCDate() + 7);
      break;
    case "monthly":
      end.setUTCMonth(end.getUTCMonth() + 1);
      break;
    case "yearly":
      end.setUTCFullYear(end.getUTCFullYear() + 1);
      break;
    default:
      throw new ValidationError(
        "Billing periods require subscription boundaries",
      );
  }
  return [start, end];
}
export function anchoredMonth(anchor: Date, months: number): Date {
  const result = new Date(anchor);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(anchor.getUTCDate(), last));
  return result;
}
