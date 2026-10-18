/** The studio has a single owner: only the addresses listed in the deployment's `ALLOWED_EMAILS` may have an account or sign in. */
export function allowedEmails(): Set<string> {
  return new Set((process.env.ALLOWED_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isAllowedEmail(value: unknown): boolean {
  const email = normalizeEmail(value);
  return email !== "" && allowedEmails().has(email);
}
