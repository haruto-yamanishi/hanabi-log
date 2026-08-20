export function safeInternalCallbackUrl(
  value: string | string[] | undefined,
): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    !candidate?.startsWith("/") ||
    /[\\\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return "/";
  }
  try {
    const base = new URL("https://hanabi.invalid");
    const resolved = new URL(candidate, base);
    if (resolved.origin !== base.origin) return "/";
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return "/";
  }
}
