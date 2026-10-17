export class SocialError extends Error {
  constructor(message, status = 400, code = 'social_error', details) {
    super(message);
    this.name = 'SocialError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
