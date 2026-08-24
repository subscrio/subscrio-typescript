/**
 * Base Entity class for all domain entities
 * Entities are identified by a unique ID
 */
export abstract class Entity<T> {
  public readonly props: T;
  private readonly _id: number | undefined;

  constructor(props: T, id?: number) {
    this.props = props;
    this._id = id;
  }

  get id(): number | undefined {
    return this._id;
  }

  public equals(entity: Entity<T>): boolean {
    if (entity === null || entity === undefined) {
      return false;
    }
    if (this === entity) {
      return true;
    }
    if (this._id === undefined || entity._id === undefined) {
      return false;
    }
    return this._id === entity._id;
  }
}

