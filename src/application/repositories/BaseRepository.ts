import { NotFoundError, ConflictError } from '../errors/index.js';

/**
 * Base repository interface providing common repository functionality
 */
export abstract class BaseRepository<T> {
  /**
   * Check if entity exists by ID
   */
  abstract exists(id: number): Promise<boolean>;

  /**
   * Find entity by ID
   */
  abstract findById(id: number): Promise<T | null>;

  /**
   * Save entity (create or update)
   * Returns the saved entity with generated ID if it was a new entity
   */
  abstract save(entity: T): Promise<T>;

  /**
   * Delete entity by ID
   */
  abstract delete(id: number): Promise<void>;

  /**
   * Get entity by ID or throw NotFoundError
   */
  protected async getByIdOrThrow(id: number): Promise<T> {
    const entity = await this.findById(id);
    if (!entity) {
      throw new NotFoundError(`Entity with ID '${id}' not found`);
    }
    return entity;
  }

  /**
   * Check if entity exists and throw ConflictError if it does
   */
  protected async checkNotExists(id: number, entityType: string): Promise<void> {
    const exists = await this.exists(id);
    if (exists) {
      throw new ConflictError(`${entityType} with ID '${id}' already exists`);
    }
  }

  /**
   * Check if entity exists and throw NotFoundError if it doesn't
   */
  protected async checkExists(id: number, entityType: string): Promise<void> {
    const exists = await this.exists(id);
    if (!exists) {
      throw new NotFoundError(`${entityType} with ID '${id}' not found`);
    }
  }
}
