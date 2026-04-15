import { Platform } from 'react-native';

/**
 * IMPORTANT: Bunny has TWO different concepts that can share the same `.b-cdn.net` hostname:
 * - Bunny Stream (encoded video library): `vz-<libraryId>.b-cdn.net/<guid>/...` and `mediadelivery.net/...`
 * - Bunny Storage Pull Zone (static files): e.g. `https://arun-storage.b-cdn.net/reels/<file>.mp4`
 *
 * Only Bunny Stream URLs can be rewritten to `playlist.m3u8` / `play_720p.mp4`.
 * Storage pull-zone URLs must be left as-is, otherwise web playback breaks with NotSupportedError.
 */

const DEFAULT_STREAM_LIBRARY_ID = '610561';
const DEFAULT_STREAM_CDN_HOST = `vz-${DEFAULT_STREAM_LIBRARY_ID}.b-cdn.net`;

export function getBunnyLibraryId(url: string): string | null {
  if (!url) return null;
  const cdnMatch = url.match(/vz-(\d+)\.b-cdn\.net\//i);
  if (cdnMatch) return cdnMatch[1];
  const iframeMatch = url.match(/embed\/(\d+)\/([a-f0-9-]{36})/i);
  if (iframeMatch) return iframeMatch[1];
  return null;
}

export function getBunnyVideoId(url: string): string | null {
  if (!url) return null;
  // Bunny Stream CDN / HLS / MP4
  const cdnMatch = url.match(/vz-(\d+)\.b-cdn\.net\/([a-f0-9-]{36})\//i);
  if (cdnMatch) return cdnMatch[2];
  // Bunny Stream embed
  const iframeMatch = url.match(/embed\/(\d+)\/([a-f0-9-]{36})/i);
  if (iframeMatch) return iframeMatch[2];
  // Bunny Stream mediadelivery
  const mediaMatch = url.match(/mediadelivery\.net\/[^/]+\/([a-f0-9-]{36})/);
  if (mediaMatch) return mediaMatch[1];
  return null;
}

export function isBunnyStreamUrl(url: string): boolean {
  if (!url) return false;
  return /mediadelivery\.net/i.test(url) || /vz-\d+\.b-cdn\.net\//i.test(url) || /iframe\.mediadelivery\.net\/embed\//i.test(url);
}

export function isBunnyStorageCdnUrl(url: string): boolean {
  if (!url) return false;
  // Any b-cdn.net that is NOT a Bunny Stream host counts as storage pull-zone.
  return /b-cdn\.net/i.test(url) && !/vz-\d+\.b-cdn\.net\//i.test(url) && !/mediadelivery\.net/i.test(url);
}

export function getBunnyEmbedUrl(url: string, autoplay = true): string | null {
  if (!isBunnyStreamUrl(url)) return null;
  const videoId = getBunnyVideoId(url);
  const libraryId = getBunnyLibraryId(url) || DEFAULT_STREAM_LIBRARY_ID;
  if (!videoId) return null;
  return `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}?autoplay=${autoplay ? 'true' : 'false'}&loop=false&muted=false&preload=false`;
}

export function getBunnyHlsUrl(url: string): string | null {
  if (!isBunnyStreamUrl(url)) return null;
  const videoId = getBunnyVideoId(url);
  const libraryId = getBunnyLibraryId(url) || DEFAULT_STREAM_LIBRARY_ID;
  if (!videoId) return null;
  return `https://vz-${libraryId}.b-cdn.net/${videoId}/playlist.m3u8`;
}

export function getBunnyMp4Url(url: string, quality: '240p' | '480p' | '720p' = '720p'): string | null {
  if (!isBunnyStreamUrl(url)) return null;
  const videoId = getBunnyVideoId(url);
  const libraryId = getBunnyLibraryId(url) || DEFAULT_STREAM_LIBRARY_ID;
  if (!videoId) return null;
  return `https://vz-${libraryId}.b-cdn.net/${videoId}/play_${quality}.mp4`;
}

export function resolveBunnyPlaybackUrl(url: string): string {
  if (!url) return url;
  // Bunny Storage pull zone URLs: keep as-is (already a direct file like .mp4)
  if (isBunnyStorageCdnUrl(url)) return url;
  // Bunny Stream URLs: rewrite to best playback format for the platform.
  if (!isBunnyStreamUrl(url)) return url;
  if (Platform.OS === 'web') return getBunnyMp4Url(url, '720p') || url;
  return getBunnyHlsUrl(url) || url;
}
