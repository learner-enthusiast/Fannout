/** A publishing failure that must not be retried (validation, permission, lost upload…). */
export class PermanentPublishError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
