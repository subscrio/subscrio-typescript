import { ValidationError, NotFoundError, ConflictError, DomainError } from '../errors/index.js';
import { now } from '../../infrastructure/utils/date.js';

/**
 * Base service class providing common functionality for all services
 */
export abstract class BaseService {
  /**
   * Validate input using Zod schema
   */
  protected validateInput<T>(
    schema: any,
    data: T,
    context: string
  ): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new ValidationError(
        `Invalid ${context} data: ${result.error.issues.map((e: any) => e.message).join(', ')}`,
        result.error.issues
      );
    }
    return result.data;
  }

  /**
   * Check if entity exists and throw appropriate error if not
   */
  protected checkEntityExists<T>(
    entity: T | null,
    entityType: string,
    identifier: string,
    context?: string
  ): T {
    if (!entity) {
      const message = context 
        ? `${entityType} with ${identifier} not found in ${context}`
        : `${entityType} with ${identifier} not found`;
      throw new NotFoundError(message);
    }
    return entity;
  }

  /**
   * Check for conflicts and throw appropriate error if found
   */
  protected checkForConflict<T>(
    existing: T | null,
    entityType: string,
    identifier: string,
    context?: string
  ): void {
    if (existing) {
      const message = context
        ? `${entityType} with ${identifier} already exists in ${context}`
        : `${entityType} with ${identifier} already exists`;
      throw new ConflictError(message);
    }
  }

  /**
   * Validate business rules and throw domain error if violated
   */
  protected validateBusinessRule(
    condition: boolean,
    message: string,
    context?: string
  ): void {
    if (!condition) {
      const fullMessage = context ? `${message} (${context})` : message;
      throw new DomainError(fullMessage);
    }
  }

  /**
   * Get current timestamp
   */
  protected getCurrentTimestamp(): Date {
    return now();
  }

  /**
   * Create timestamp pair for new entities
   */
  protected createTimestamps(): { createdAt: Date; updatedAt: Date } {
    const timestamp = now();
    return {
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  /**
   * Update timestamp for existing entities
   */
  protected updateTimestamp(): Date {
    return now();
  }
}
