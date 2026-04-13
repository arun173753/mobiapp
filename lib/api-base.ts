/**
 * Default production API used when EXPO_PUBLIC_API_URL / EXPO_PUBLIC_DOMAIN
 * are missing from the native binary (e.g. misconfigured EAS env).
 * Override via EAS secrets — keep in sync with your Cloud Run service.
 */
export const DEFAULT_PRODUCTION_API_ORIGIN =
  "https://repair-backendarun-838751841074.asia-south1.run.app";

/** Normalize host or origin: trim slashes, ensure https:// for URL(base) usage */
export function normalizeApiOrigin(raw: string | undefined): string {
  if (!raw?.trim()) return "";
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) {
    u = `https://${u}`;
  }
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

/** True for localhost / loopback — must not be used in production client bundles. */
export function isLoopbackOrigin(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}
