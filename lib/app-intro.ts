import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '@/lib/api-base';
import { robustFetch } from '@/lib/api-client';
import {
  getBunnyMp4Url,
  isBunnyStorageCdnUrl,
  isBunnyStreamUrl,
  resolveBunnyPlaybackUrl,
} from '@/lib/bunny-cdn';
import {
  cloudflareStreamMp4Fallback,
  mergeCloudflareStreamBandwidthHint,
  normalizeCloudflareStreamPlaybackUrl,
} from '@/lib/stream-video';

const INTRO_CACHE_KEY = 'app_intro_config_v3';

/** Intro plays quietly (not muted) on app open. */
export const INTRO_PLAYBACK_VOLUME = 1;

export type AppIntroConfig = {
  enabled: boolean;
  videoUrl: string;
  durationSeconds: number;
};

function isDirectVideoFile(url: string): boolean {
  return /\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(url);
}

/** Ordered playback URLs: prefer MP4 on native (HLS often fails in expo-av). */
export function getIntroPlaybackCandidates(url: string): string[] {
  const trimmed = (url || '').trim();
  if (!trimmed) return [];

  const out: string[] = [];
  const push = (candidate: string | null | undefined) => {
    const u = String(candidate || '').trim();
    if (!u || out.includes(u)) return;
    out.push(u);
  };

  if (isDirectVideoFile(trimmed) && !trimmed.includes('cloudflarestream.com')) {
    push(trimmed);
    return out;
  }

  if (isBunnyStorageCdnUrl(trimmed) || (isBunnyStreamUrl(trimmed) && /\.mp4/i.test(trimmed))) {
    push(trimmed);
  }

  if (isBunnyStreamUrl(trimmed)) {
    push(getBunnyMp4Url(trimmed, '720p'));
    push(getBunnyMp4Url(trimmed, '480p'));
    push(resolveBunnyPlaybackUrl(trimmed));
    push(trimmed);
    return out;
  }

  if (isDirectVideoFile(trimmed)) {
    push(trimmed);
  }

  const cfHls = normalizeCloudflareStreamPlaybackUrl(trimmed);
  if (cfHls) {
    push(cloudflareStreamMp4Fallback(trimmed));
    push(mergeCloudflareStreamBandwidthHint(cfHls, 4));
    push(trimmed);
    return out;
  }

  push(trimmed);
  return out;
}

/** Primary intro URL (first candidate). */
export function normalizeIntroPlaybackUrl(url: string): string {
  return getIntroPlaybackCandidates(url)[0] || '';
}

export function cloudflareIntroVideoId(url: string): string | null {
  const manifest = normalizeCloudflareStreamPlaybackUrl(url) || (url || '').trim();
  if (!manifest || !manifest.includes('cloudflarestream.com')) return null;
  try {
    const id = new URL(manifest).pathname.split('/').filter(Boolean)[0];
    return id && /^[a-f0-9-]{16,64}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Native WebView embed (same host pattern as app/video-player — reliable on APK). */
export function cloudflareIntroEmbedUrl(url: string, muted = false): string | null {
  const manifest = normalizeCloudflareStreamPlaybackUrl(url) || (url || '').trim();
  if (!manifest || !manifest.includes('cloudflarestream.com')) return null;
  try {
    const u = new URL(manifest);
    const id = u.pathname.split('/').filter(Boolean)[0];
    if (!id || !/^[a-f0-9-]{16,64}$/i.test(id)) return null;
    const params = new URLSearchParams({
      letterboxColor: 'black',
      primaryColor: '%23FF6B2C',
      autoplay: 'true',
      muted: muted ? 'true' : 'false',
      controls: 'false',
      preload: 'auto',
    });
    return `https://${u.hostname}/${id}/iframe?${params.toString()}`;
  } catch {
    return null;
  }
}

export function isCloudflareIntroUrl(url: string): boolean {
  return Boolean(cloudflareIntroVideoId(url));
}

/** URLs for in-WebView HTML player (HLS first for Cloudflare). */
export function getIntroWebPlaybackCandidates(url: string): string[] {
  const trimmed = (url || '').trim();
  if (!trimmed) return [];

  const cfHls = normalizeCloudflareStreamPlaybackUrl(trimmed);
  if (cfHls) {
    const out: string[] = [];
    const push = (u: string | null | undefined) => {
      const s = String(u || '').trim();
      if (s && !out.includes(s)) out.push(s);
    };
    push(mergeCloudflareStreamBandwidthHint(cfHls, 4));
    push(cloudflareStreamMp4Fallback(trimmed));
    push(getBunnyMp4Url(trimmed, '720p'));
    push(trimmed);
    return out.length ? out : getIntroPlaybackCandidates(trimmed);
  }
  return getIntroPlaybackCandidates(trimmed);
}

function introWebViewBaseUrl(url: string): string {
  const first = getIntroWebPlaybackCandidates(url)[0] || url;
  try {
    return new URL(first).origin;
  } catch {
    return 'https://localhost';
  }
}

/** Self-contained HTML player — plays HLS/MP4 inside WebView (works on APK). */
export function buildIntroWebPlayerHtml(url: string): { html: string; baseUrl: string } {
  const sources = getIntroWebPlaybackCandidates(url);
  const sourcesJson = JSON.stringify(sources);
  const vol = INTRO_PLAYBACK_VOLUME;
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
  video { width: 100%; height: 100%; object-fit: cover; background: #000; }
</style>
</head>
<body>
<video id="v" playsinline webkit-playsinline autoplay muted></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js"><\/script>
<script>
(function() {
  var sources = ${sourcesJson};
  var vol = ${vol};
  var idx = 0;
  var hls = null;
  var v = document.getElementById('v');
  function post(type) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: type }));
    }
  }
  function cleanup() {
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
  }
  var soundOn = false;
  window.setIntroSound = function(on) {
    soundOn = !!on;
    v.muted = !soundOn;
    if (soundOn) v.volume = vol;
    try { v.play(); } catch (e) {}
  };
  function playOk() {
    v.muted = !soundOn;
    if (soundOn) v.volume = vol;
    post('playing');
  }
  function tryNext() {
    if (idx >= sources.length) { post('failed'); return; }
    var src = sources[idx++];
    cleanup();
    v.muted = true;
    var isHls = /\\.m3u8(\\?|#|$)/i.test(src) || /\\/manifest\\//i.test(src);
    if (isHls && window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(src);
      hls.attachMedia(v);
      hls.on(window.Hls.Events.MANIFEST_PARSED, function() {
        v.play().then(playOk).catch(tryNext);
      });
      hls.on(window.Hls.Events.ERROR, function(_, data) {
        if (data && data.fatal) tryNext();
      });
      return;
    }
    if (isHls && v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = src;
      v.play().then(playOk).catch(tryNext);
      return;
    }
    v.src = src;
    v.play().then(playOk).catch(tryNext);
  }
  v.addEventListener('ended', function() { post('ended'); });
  v.addEventListener('timeupdate', function() {
    if (v.duration > 0 && v.currentTime >= v.duration - 0.35) post('ended');
  });
  tryNext();
})();
<\/script>
</body>
</html>`;
  return { html, baseUrl: introWebViewBaseUrl(url) };
}

function parseIntroConfig(data: Record<string, unknown>): AppIntroConfig {
  const videoUrl = String(data?.videoUrl || '').trim();
  const durationSeconds = Math.max(0, Math.floor(Number(data?.durationSeconds) || 0));
  const enabled = Boolean(data?.enabled) || Boolean(videoUrl);
  return { enabled, videoUrl, durationSeconds };
}

export async function getCachedAppIntroConfig(): Promise<AppIntroConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(INTRO_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppIntroConfig;
    const cfg = parseIntroConfig(parsed as unknown as Record<string, unknown>);
    if (!cfg.videoUrl) return null;
    return cfg;
  } catch {
    return null;
  }
}

async function cacheAppIntroConfig(cfg: AppIntroConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(INTRO_CACHE_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

export async function fetchAppIntroConfig(): Promise<AppIntroConfig> {
  try {
    const res = await robustFetch(`${getApiUrl()}/api/app/intro`, { method: 'GET' }, 15000);
    const data = await res.json().catch(() => ({}));
    const cfg = parseIntroConfig(data as Record<string, unknown>);
    if (cfg.videoUrl) await cacheAppIntroConfig(cfg);
    return cfg;
  } catch {
    const cached = await getCachedAppIntroConfig();
    return cached || { enabled: false, videoUrl: '', durationSeconds: 0 };
  }
}
