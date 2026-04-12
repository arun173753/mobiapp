import { Platform } from 'react-native';

const LIBRARY_ID = '610561';
const CDN_HOST = `vz-${LIBRARY_ID}.b-cdn.net`;

export function getBunnyVideoId(url: string): string | null {
  if (!url) return null;
  const cdnMatch = url.match(/b-cdn\.net\/([a-f0-9-]{36})\//);
  if (cdnMatch) return cdnMatch[1];
  const iframeMatch = url.match(/embed\/\d+\/([a-f0-9-]{36})/);
  if (iframeMatch) return iframeMatch[1];
  const mediaMatch = url.match(/mediadelivery\.net\/[^/]+\/([a-f0-9-]{36})/);
  if (mediaMatch) return mediaMatch[1];
  return null;
}

export function isBunnyUrl(url: string): boolean {
  return url.includes('b-cdn.net') || url.includes('mediadelivery.net');
}

export function getBunnyEmbedUrl(url: string, autoplay = true): string | null {
  const videoId = getBunnyVideoId(url);
  if (!videoId) return null;
  return `https://iframe.mediadelivery.net/embed/${LIBRARY_ID}/${videoId}?autoplay=${autoplay ? 'true' : 'false'}&loop=false&muted=false&preload=false`;
}

export function getBunnyHlsUrl(url: string): string | null {
  const videoId = getBunnyVideoId(url);
  if (!videoId) return null;
  return `https://${CDN_HOST}/${videoId}/playlist.m3u8`;
}

export function getBunnyMp4Url(url: string, quality: '240p' | '480p' | '720p' = '720p'): string | null {
  const videoId = getBunnyVideoId(url);
  if (!videoId) return null;
  return `https://${CDN_HOST}/${videoId}/play_${quality}.mp4`;
}

export function resolveBunnyPlaybackUrl(url: string): string {
  if (!url || !isBunnyUrl(url)) return url;
  if (Platform.OS === 'web') {
    return getBunnyMp4Url(url, '720p') || url;
  }
  return getBunnyHlsUrl(url) || url;
}
