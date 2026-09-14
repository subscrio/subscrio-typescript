/**
 * Domain business rule violation.
 * Lives in the domain layer so entities do not import application types.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
