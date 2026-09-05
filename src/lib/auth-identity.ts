const googleUserIdPrefix = "google:";

/**
 * Convert Google's stable subject claim into the application's user key.
 * Keeping the provider prefix makes the key unambiguous if another OAuth
 * provider is introduced later.
 */
export function googleUserId(subject: string): string {
  const normalizedSubject = subject.trim();
  if (!normalizedSubject) {
    throw new Error("Google subject must not be empty");
  }

  return `${googleUserIdPrefix}${normalizedSubject}`;
}
