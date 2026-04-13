/**
 * Default production API when EXPO_PUBLIC_API_URL is missing from the client bundle.
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

/** Placeholder / tutorial hosts — never use in shipped web or release APK (often set in .env.local). */
export function isPlaceholderApiOrigin(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "example.com" || h.endsWith(".example.com");
  } catch {
    return false;
  }
}

/** Firebase Hosting / Auth hosting — the static app origin, not your Cloud Run API. */
export function isFirebaseHostingOrigin(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.endsWith(".web.app") || h.endsWith(".firebaseapp.com");
  } catch {
    return false;
  }
}

export function isUnusableProductionApiOrigin(url: string): boolean {
  return (
    isLoopbackOrigin(url) ||
    isPlaceholderApiOrigin(url) ||
    isFirebaseHostingOrigin(url)
  );
}
