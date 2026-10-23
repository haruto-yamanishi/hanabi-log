// Server-side allowlist: JSON mapping verified Google emails to real Slack user IDs.
export function googleSlackUserId(configuration: string | undefined, email: unknown): string | null {
  if (!configuration || typeof email !== "string" || !email.trim()) return null;
  try {
    const entries: unknown = JSON.parse(configuration);
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) return null;
    const matches = Object.entries(entries).filter(([key]) => key.trim().toLowerCase() === email.trim().toLowerCase());
    if (matches.length !== 1) return null;
    const id: unknown = matches[0][1];
    return typeof id === "string" && /^[UW][A-Z0-9]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function verifiedGoogleIdentity(configuration: string | undefined, profile: unknown) {
  if (!profile || typeof profile !== "object") return null;
  const data = profile as Record<string, unknown>;
  if (data.email_verified !== true || typeof data.sub !== "string" || !data.sub) return null;
  const slackUserId = googleSlackUserId(configuration, data.email);
  if (!slackUserId) return null;
  return {
    slackUserId,
    email: (data.email as string).trim().toLowerCase(),
    displayName: typeof data.name === "string" && data.name ? data.name : "Mentor",
    avatarUrl: typeof data.picture === "string" ? data.picture : null,
  };
}
