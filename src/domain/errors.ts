/** Códigos estables: la UI los traducirá sin depender del mensaje en inglés o español. */
export type DomainErrorCode =
  | 'UNKNOWN_CURRENCY'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'INVALID_SPLIT'
  | 'INVALID_PAYERS'
  | 'INVALID_RATE'
  | 'INVALID_TRANSFER'
  | 'UNBALANCED';

/** Error de una regla de negocio. El mensaje es para desarrolladores; la UI usa `code`. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
