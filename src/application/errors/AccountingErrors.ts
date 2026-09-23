import { DomainError, ConflictError } from "./index.js";
import type { CreditCostDto } from "../dtos/CreditDto.js";
import type { UsageDto } from "../dtos/MeteringDto.js";
export class UsageLimitExceededError extends DomainError {
  constructor(public readonly usage: UsageDto) {
    super("Usage limit exceeded");
    this.name = "UsageLimitExceededError";
  }
}
export class InsufficientCreditsError extends DomainError {
  constructor(public readonly costs: CreditCostDto[]) {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}
export class IdempotencyConflictError extends ConflictError {
  constructor() {
    super("Idempotency key was already used with a different request");
    this.name = "IdempotencyConflictError";
  }
}
export class MeteringPeriodError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "MeteringPeriodError";
  }
}
