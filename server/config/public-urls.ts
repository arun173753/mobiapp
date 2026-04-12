/**
 * Public URLs and OAuth — read from env only (no hardcoded production hosts).
 */

export function apiPublicBase(): string {
  const raw =
    process.env.API_PUBLIC_URL ||
    process.env.APP_DOMAIN ||
    process.env.EXPO_PUBLIC_API_URL ||
    "";
  return raw.trim().replace(/\/+$/, "");
}

export function googleOAuthClientId(): string {
  return (process.env.GOOGLE_CLIENT_ID || "").trim();
}

export function googleOAuthRedirectUri(): string {
  const explicit = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = apiPublicBase();
  return base ? `${base}/api/auth/google/callback` : "";
}

export function uploadsPublicFileUrl(localFilename: string): string {
  const base = apiPublicBase();
  if (base) return `${base}/uploads/${localFilename}`;
  const port = process.env.PORT || "5000";
  return `http://127.0.0.1:${port}/uploads/${localFilename}`;
}
