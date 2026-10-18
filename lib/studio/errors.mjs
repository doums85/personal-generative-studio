export class StudioStoreError extends Error {
  constructor(message, status = 400, code = 'store_error') {
    super(message);
    this.name = 'StudioStoreError';
    this.status = status;
    this.code = code;
  }
}
