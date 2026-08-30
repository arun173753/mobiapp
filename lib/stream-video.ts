/**
 * Cloudflare Stream + HLS helpers for expo-av and URL normalization.
 * Prefer canonical HLS: `https://customer-<CODE>.cloudflarestream.com/<VIDEO_ID>/manifest/video.m3u8`
 */

const CF_CUSTOMER_HOST_RE = /^customer-[a-z0-9-]+\.cloudflarestream\.com$/i;

function isCloudflareStreamPlaybackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'videodelivery.net' || h === 'iframe.videodelivery.net' || CF_CUSTOMER_HOST_RE.test(h);
}

/**
 * Rewrite any known Cloudflare Stream playback URL to the main adaptive HLS manifest.
 * Preserves query string (e.g. signed URLs). Returns null when the URL is not Cloudflare Stream playback.
 */
export function normalizeCloudflareStreamPlaybackUrl(url: string): string | null {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname;
  if (!isCloudflareStreamPlaybackHost(host)) return null;

  const parts = u.pathname.split('/').filter(Boolean);
  let id: string | null = null;

  if (host.toLowerCase() === 'iframe.videodelivery.net') {
    if (parts[0]?.toLowerCase() === 'embed' && parts[1]) id = parts[1];
    else if (parts[0]) id = parts[0];
  } else if (parts.length) {
    id = parts[0];
  }

  if (!id || !/^[a-f0-9-]{16,64}$/i.test(id)) return null;

  const search = u.search || '';
  return `${u.protocol}//${u.host}/${id}/manifest/video.m3u8${search}`;
}

/**
 * Cloudflare Stream HLS: optional `clientBandwidthHint` (Mbps) nudges ABR toward higher renditions.
 * Does not override an existing query param (e.g. server-set). No-op for non-Stream URLs.
 * @see https://developers.cloudflare.com/stream/viewing-videos/using-own-player/
 */
export function mergeCloudflareStreamBandwidthHint(manifestUrl: string, hintMbps: number): string {
  if (!hintMbps || !Number.isFinite(hintMbps) || hintMbps <= 0) return manifestUrl;
  try {
    const u = new URL(manifestUrl);
    if (!isCloudflareStreamPlaybackHost(u.hostname)) return manifestUrl;
    if (!/\/manifest\/video\.m3u8$/i.test(u.pathname)) return manifestUrl;
    if (u.searchParams.has('clientBandwidthHint')) return manifestUrl;
    u.searchParams.set('clientBandwidthHint', String(hintMbps));
    return u.toString();
  } catch {
    return manifestUrl;
  }
}

function isHlsUri(uri: string): boolean {
  const u = (uri || '').trim();
  return /\.m3u8(\?|#|$)/i.test(u) || /\/manifest\/[^/?#]+\.m3u8/i.test(u);
}

/**
 * expo-av: hint HLS to the native stack (Accept + Android extension override).
 */
/** MP4 fallback when Cloudflare HLS fails in expo-av (common on some Android builds). */
export function cloudflareStreamMp4Fallback(url: string): string | null {
  const manifest = normalizeCloudflareStreamPlaybackUrl(url) || (url || "").trim();
  if (!manifest || !isCloudflareStreamPlaybackHost(new URL(manifest).hostname)) return null;
  try {
    const u = new URL(manifest);
    const id = u.pathname.split("/").filter(Boolean)[0];
    if (!id || !/^[a-f0-9-]{16,64}$/i.test(id)) return null;
    return `${u.protocol}//${u.host}/${id}/downloads/default.mp4`;
  } catch {
    return null;
  }
}

export function buildExpoAvStreamSource(uri: string): { uri: string; headers?: Record<string, string>; overrideFileExtensionAndroid?: string } {
  const u = (uri || '').trim();
  if (!u || !isHlsUri(u)) return { uri: u };
  return {
    uri: u,
    headers: { Accept: 'application/vnd.apple.mpegurl' },
    overrideFileExtensionAndroid: 'm3u8',
  };
}
