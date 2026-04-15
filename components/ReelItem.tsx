import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import { Share } from 'react-native';
import { getApiUrl } from '@/lib/query-client';
import { getBunnyHlsUrl, getBunnyMp4Url, isBunnyStreamUrl, resolveBunnyPlaybackUrl } from '@/lib/bunny-cdn';
import type { Reel } from '@/lib/types';

const { width: SW, height: SH } = Dimensions.get('window');

type Props = {
  reel: Reel;
  isActive: boolean;
  currentUserId?: string;
  onLike: (reelId: string) => void;
  onOpenComments: (reel: Reel) => void;
  onView?: (reelId: string) => void;
  onRetry?: () => void;
};

function normalizeReel(reel: Reel): Reel {
  return {
    ...reel,
    userName: typeof reel.userName === 'string' && reel.userName.trim() ? reel.userName : 'User',
    title: typeof reel.title === 'string' ? reel.title : '',
    description: typeof reel.description === 'string' ? reel.description : '',
    videoUrl: typeof reel.videoUrl === 'string' ? reel.videoUrl : '',
    thumbnailUrl: typeof reel.thumbnailUrl === 'string' ? reel.thumbnailUrl : '',
    likes: Array.isArray((reel as any).likes) ? (reel as any).likes : [],
    comments: Array.isArray((reel as any).comments) ? (reel as any).comments : [],
    views: typeof (reel as any).views === 'number' && Number.isFinite((reel as any).views) ? (reel as any).views : 0,
    createdAt: typeof reel.createdAt === 'number' ? reel.createdAt : Date.now(),
  };
}

export default function ReelItem({
  reel,
  isActive,
  currentUserId,
  onLike,
  onOpenComments,
  onView,
  onRetry,
}: Props) {
  const safeReel = useMemo(() => normalizeReel(reel), [reel]);
  const baseUrl = getApiUrl();

  const rawVideoUrl = useMemo(() => {
    const u = String(safeReel.videoUrl || '').trim();
    if (!u) return '';
    if (/^https?:\/\//i.test(u) || u.includes('b-cdn.net') || u.includes('mediadelivery.net')) return u;
    return `${baseUrl}${u.startsWith('/') ? '' : '/'}${u}`;
  }, [baseUrl, safeReel.videoUrl]);

  const webVideoSources = useMemo(() => {
    if (!rawVideoUrl) return [];
    if (!isBunnyStreamUrl(rawVideoUrl)) return [rawVideoUrl];
    const candidates = [
      getBunnyMp4Url(rawVideoUrl, '720p'),
      getBunnyMp4Url(rawVideoUrl, '480p'),
      getBunnyHlsUrl(rawVideoUrl),
      rawVideoUrl,
    ].filter((u): u is string => !!u);
    return Array.from(new Set(candidates));
  }, [rawVideoUrl]);

  const nativeVideoSource = useMemo(() => {
    if (!rawVideoUrl) return '';
    return isBunnyStreamUrl(rawVideoUrl) ? resolveBunnyPlaybackUrl(rawVideoUrl) : rawVideoUrl;
  }, [rawVideoUrl]);

  const [sourceIndex, setSourceIndex] = useState(0);
  const [webMuted, setWebMuted] = useState(true);
  const videoSource = Platform.OS === 'web'
    ? (webVideoSources[sourceIndex] || webVideoSources[0] || '')
    : nativeVideoSource;

  const isLiked = !!currentUserId && safeReel.likes.includes(currentUserId);

  const videoRef = useRef<Video | null>(null);
  const webVideoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReady(false);
    setBuffering(false);
    setError(null);
    setSourceIndex(0);
    setWebMuted(true);
  }, [rawVideoUrl, isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (!safeReel.id) return;
    onView?.(safeReel.id);
  }, [isActive, safeReel.id, onView]);

  useEffect(() => {
    console.log('VIDEO URL:', safeReel.videoUrl);
    if (Platform.OS === 'web') {
      console.log('VIDEO SOURCE:', videoSource);
    }
  }, [safeReel.id, safeReel.videoUrl, sourceIndex, videoSource, webVideoSources]);

  const switchToNextSource = useCallback((finalError: string) => {
    if (Platform.OS !== 'web') {
      setError(finalError);
      return;
    }
    setSourceIndex((prev) => {
      const next = prev + 1;
      if (next < webVideoSources.length) {
        setReady(false);
        setBuffering(true);
        setError(null);
        return next;
      }
      setReady(true);
      setBuffering(false);
      setError(finalError);
      return prev;
    });
  }, [webVideoSources.length]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = webVideoRef.current;
    if (!el) return;
    let disposed = false;
    let hlsInstance: any = null;

    const playElement = async () => {
      try {
        const playPromise = el.play();
        if (playPromise && typeof (playPromise as Promise<void>).catch === 'function') {
          await playPromise;
        }
      } catch (e: unknown) {
        if (!disposed) switchToNextSource(String((e as Error)?.message || e || 'Video failed to play'));
      }
    };

    const loadWebSource = async () => {
      const src = String(videoSource || '').trim();
      if (!src) return;
      const isHlsSrc = /\.m3u8(\?|#|$)/i.test(src);

      if (isHlsSrc) {
        const canPlayNative = !!(el.canPlayType('application/vnd.apple.mpegurl') || el.canPlayType('application/x-mpegURL'));
        if (!canPlayNative) {
          try {
            const HlsModule = await import('hls.js');
            const HlsCtor = (HlsModule as any)?.default;
            if (HlsCtor?.isSupported?.()) {
              hlsInstance = new HlsCtor({
                enableWorker: true,
                lowLatencyMode: true,
              });
              hlsInstance.attachMedia(el);
              hlsInstance.on(HlsCtor.Events.MEDIA_ATTACHED, () => {
                if (!disposed) hlsInstance.loadSource(src);
              });
              hlsInstance.on(HlsCtor.Events.MANIFEST_PARSED, () => {
                if (!disposed && isActive) void playElement();
              });
              hlsInstance.on(HlsCtor.Events.ERROR, (_evt: any, data: any) => {
                if (!disposed && data?.fatal) {
                  switchToNextSource('Video failed to load');
                }
              });
              return;
            }
          } catch {
            // fall through and try direct src assignment
          }
        }
      }
      el.src = src;
      el.muted = webMuted;
      if (isActive) void playElement();
    };

    if (!isActive) {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {
        // ignore
      }
      if (hlsInstance) {
        try { hlsInstance.destroy(); } catch { /* ignore */ }
      }
      return;
    }
    void loadWebSource();
    return () => {
      disposed = true;
      if (hlsInstance) {
        try { hlsInstance.destroy(); } catch { /* ignore */ }
      }
    };
  }, [isActive, videoSource, switchToNextSource, webMuted]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!isActive || !videoSource || ready || !!error) return;
    const t = setTimeout(() => {
      switchToNextSource('Video is taking too long to start');
    }, 12000);
    return () => clearTimeout(t);
  }, [error, isActive, ready, switchToNextSource, videoSource]);

  const handleShare = async () => {
    try {
      const title = safeReel.title || 'Reel';
      const message = safeReel.description ? `${title}\n\n${safeReel.description}` : title;
      await Share.share({ message, title });
    } catch (e) {
      // ignore
    }
  };

  const thumbUri = useMemo(() => {
    const t = String(safeReel.thumbnailUrl || '').trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t) || t.includes('b-cdn.net')) return t;
    return `${baseUrl}${t.startsWith('/') ? '' : '/'}${t}`;
  }, [baseUrl, safeReel.thumbnailUrl]);

  const showLoader = !ready || buffering;

  return (
    <View style={s.wrap}>
      <View style={s.videoStage}>
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000' }]} />
        )}

        {videoSource ? (
          Platform.OS === 'web' ? (
            <video
              ref={webVideoRef}
              src={videoSource}
              autoPlay={isActive}
              loop
              muted={webMuted}
              defaultMuted={webMuted}
              playsInline
              preload="auto"
              // @ts-expect-error web-only intrinsic element prop
              controls={false}
              className="reels-web-video"
              style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                inset: 0,
              }}
              onCanPlay={() => {
                setReady(true);
                setBuffering(false);
              }}
              onLoadedData={() => {
                setReady(true);
                setBuffering(false);
              }}
              onWaiting={() => setBuffering(true)}
              onPlaying={() => {
                setReady(true);
                setBuffering(false);
              }}
              onPause={() => setBuffering(false)}
              onError={() => {
                switchToNextSource('Video failed to load');
              }}
            />
          ) : (
            <Video
              ref={videoRef as any}
              source={{ uri: videoSource }}
              style={StyleSheet.absoluteFillObject}
              resizeMode={ResizeMode.COVER}
              isLooping
              shouldPlay={isActive}
              isMuted={false}
              useNativeControls={false}
              onReadyForDisplay={() => setReady(true)}
              onError={(e) => {
                setReady(true);
                setError(String((e as any)?.error || (e as any)?.message || 'Video failed to load'));
              }}
              onPlaybackStatusUpdate={(st: AVPlaybackStatus) => {
                if (!st.isLoaded) return;
                setBuffering(!!st.isBuffering);
              }}
            />
          )
        ) : null}

        {showLoader ? (
          <View pointerEvents="none" style={s.centerOverlay}>
            <ActivityIndicator color="#fff" />
            <Text style={s.centerText}>{buffering ? 'Buffering…' : 'Loading…'}</Text>
          </View>
        ) : null}

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorTitle}>Video failed</Text>
            <Text style={s.errorMsg} numberOfLines={2}>{error}</Text>
            <Pressable style={s.retryBtn} onPress={onRetry}>
              <Text style={s.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : !videoSource ? (
          <View style={s.errorBox}>
            <Text style={s.errorTitle}>Video not available</Text>
            <Text style={s.errorMsg} numberOfLines={2}>This reel does not have a valid video source.</Text>
          </View>
        ) : null}
      </View>

      {/* Views badge */}
      <View style={s.viewsBadge}>
        <Ionicons name="eye-outline" size={15} color="#fff" />
        <Text style={s.viewsText}>{safeReel.views || 0}</Text>
      </View>

      {Platform.OS === 'web' && !error ? (
        <Pressable
          style={s.muteBtn}
          onPress={() => {
            const nextMuted = !webMuted;
            setWebMuted(nextMuted);
            const el = webVideoRef.current;
            if (!el) return;
            try {
              el.muted = nextMuted;
              if (isActive) {
                const p = el.play();
                if (p && typeof (p as Promise<void>).catch === 'function') {
                  (p as Promise<void>).catch(() => {});
                }
              }
            } catch {
              // ignore
            }
          }}
          hitSlop={10}
        >
          <Ionicons name={webMuted ? 'volume-mute' : 'volume-high'} size={18} color="#fff" />
          <Text style={s.muteBtnText}>{webMuted ? 'Tap for sound' : 'Sound on'}</Text>
        </Pressable>
      ) : null}

      {/* Right actions */}
      <View style={s.actionStack} pointerEvents="box-none">
        <Pressable style={s.actionBtn} onPress={() => onLike(safeReel.id)} hitSlop={10}>
          <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={32} color={isLiked ? '#FF3040' : '#fff'} />
          <Text style={s.countText}>{safeReel.likes.length}</Text>
        </Pressable>

        <Pressable style={s.actionBtn} onPress={() => onOpenComments(safeReel)} hitSlop={10}>
          <Ionicons name="chatbubble-outline" size={30} color="#fff" />
          <Text style={s.countText}>{safeReel.comments.length}</Text>
        </Pressable>

        <Pressable style={s.actionBtn} onPress={handleShare} hitSlop={10}>
          <Ionicons name="share-social-outline" size={30} color="#fff" />
          <Text style={s.countText}>Share</Text>
        </Pressable>
      </View>

      {/* Bottom info */}
      <View style={s.bottomInfo} pointerEvents="none">
        <Text style={s.username} numberOfLines={1}>{safeReel.userName}</Text>
        {(safeReel.title || safeReel.description) ? (
          <Text style={s.caption} numberOfLines={2}>
            {safeReel.title ? safeReel.title : safeReel.description}
          </Text>
        ) : null}
        {/* Optional: audio/tag can be added later without changing layout */}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    width: Platform.OS === 'web' ? ('100vw' as any) : SW,
    height: Platform.OS === 'web' ? ('100vh' as any) : SH,
    backgroundColor: '#000',
    position: 'relative',
    overflow: 'hidden',
  },
  videoStage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    inset: 0,
    backgroundColor: '#000',
  },
  centerOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -70 }, { translateY: -20 }],
    width: 140,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 5,
  },
  centerText: { color: '#fff', marginTop: 6, fontSize: 12, fontWeight: '600' },
  errorBox: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 140,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.75)',
    zIndex: 6,
  },
  errorTitle: { color: '#fff', fontWeight: '800', fontSize: 14, marginBottom: 4 },
  errorMsg: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginBottom: 10 },
  retryBtn: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#fff' },
  retryText: { color: '#111', fontWeight: '800' },

  viewsBadge: {
    position: 'absolute',
    left: 12,
    top: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    zIndex: 10,
  },
  viewsText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  muteBtn: {
    position: 'absolute',
    right: 12,
    top: 46,
    zIndex: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  muteBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  actionStack: {
    position: 'absolute',
    right: 10,
    bottom: 120,
    zIndex: 10,
    alignItems: 'center',
    gap: 22,
  },
  actionBtn: { alignItems: 'center' },
  countText: {
    marginTop: 4,
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  bottomInfo: {
    position: 'absolute',
    left: 12,
    right: 70,
    bottom: 24,
    zIndex: 10,
  },
  username: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  caption: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});

