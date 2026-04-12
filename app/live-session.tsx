import React, { useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator, Linking, Share } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';

const C = Colors.light;
const RED = '#EF4444';

const BUNNY_PLAYER_HTML = (embedUrl: string, title: string) => `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
* { margin:0; padding:0; box-sizing:border-box; background:#000; }
body { background:#000; width:100vw; height:100vh; display:flex; align-items:center; justify-content:center; }
iframe { width:100%; height:100%; border:none; }
</style>
</head>
<body>
<iframe
  src="${embedUrl}"
  allow="camera; microphone; display-capture; autoplay; encrypted-media; fullscreen; picture-in-picture"
  allowfullscreen
></iframe>
</body>
</html>`;

export default function LiveSessionScreen() {
  const params = useLocalSearchParams();
  const url = Array.isArray(params.url) ? params.url[0] : params.url;
  const title = Array.isArray(params.title) ? params.title[0] : params.title;
  const platform = Array.isArray(params.platform) ? params.platform[0] : params.platform;
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [webError, setWebError] = useState(false);
  const [progress, setProgress] = useState(0);
  const webViewRef = useRef<any>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const isBunnyLive  = platform === 'bunny' || (url || '').includes('iframe.mediadelivery.net/live');
  const isYouTube    = (url || '').includes('youtube.com') || (url || '').includes('youtu.be');

  const openInBrowser = useCallback(() => {
    if (url) Linking.openURL(url).catch(() => {});
  }, [url]);

  const shareSession = useCallback(async () => {
    try {
      await Share.share({ message: `Join live session: ${title}\n${url}`, title: title || 'Live Session' });
    } catch {}
  }, [url, title]);

  const getEmbedUrl = (rawUrl: string): string => {
    if (!rawUrl) return '';
    // Bunny live embed — use as-is
    if (rawUrl.includes('iframe.mediadelivery.net')) return rawUrl;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) {
        let videoId = '';
        if (parsed.hostname.includes('youtu.be')) {
          videoId = parsed.pathname.slice(1).split('/')[0];
        } else {
          videoId = parsed.searchParams.get('v') || '';
          if (!videoId && parsed.pathname.includes('/live/')) {
            videoId = parsed.pathname.split('/live/')[1]?.split('/')[0] || '';
          }
        }
        if (videoId) return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1&enablejsapi=1`;
      }
    } catch {}
    return rawUrl;
  };

  const headerBg = isBunnyLive ? '#0F0F0F' : '#FFF';
  const headerTextColor = isBunnyLive ? '#FFF' : C.text;

  // ── Web platform ──────────────────────────────────────────────────────────
  if (Platform.OS === 'web') {
    const embedSrc = getEmbedUrl(url || '');

    // YouTube live streams block <iframe> embedding via X-Frame-Options.
    // Show a branded redirect page instead so the user can tap to open YouTube.
    if (isYouTube) {
      const ytColor = '#FF0000';
      return (
        <View style={[styles.container, { paddingTop: topPad, backgroundColor: '#FFF' }]}>
          <View style={[styles.header, { backgroundColor: '#FFF', borderBottomColor: '#F0F0F0' }]}>
            <Pressable hitSlop={12} onPress={() => router.back()} style={styles.headerBtn}>
              <Ionicons name="arrow-back" size={24} color={C.text} />
            </Pressable>
            <View style={styles.titleWrap}>
              <View style={[styles.liveDot, { backgroundColor: RED }]} />
              <Text style={[styles.headerTitle, { color: C.text }]} numberOfLines={1}>
                {title || 'Live Session'}
              </Text>
            </View>
            <View style={styles.headerBtn} />
          </View>

          <View style={styles.ytRedirectContainer}>
            <View style={[styles.ytIconCircle, { backgroundColor: ytColor + '15' }]}>
              <Ionicons name="logo-youtube" size={56} color={ytColor} />
            </View>
            <View style={[styles.livePill]}>
              <View style={[styles.liveDot, { backgroundColor: RED, width: 9, height: 9, borderRadius: 5 }]} />
              <Text style={styles.livePillText}>LIVE NOW</Text>
            </View>
            <Text style={styles.ytTitle} numberOfLines={3}>{title || 'Live Session'}</Text>
            <Text style={styles.ytSub}>
              This live stream plays on YouTube.{'\n'}Tap below to watch it now.
            </Text>
          <Pressable
            style={[styles.ytWatchBtn, { backgroundColor: ytColor }]}
            onPress={() => { if (url) Linking.openURL(url).catch(() => {}); }}
          >
              <Ionicons name="logo-youtube" size={20} color="#FFF" />
              <Text style={styles.ytWatchBtnText}>Watch on YouTube</Text>
            </Pressable>
            <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
              <Text style={{ fontSize: 14, color: C.textSecondary, fontFamily: 'Inter_400Regular' }}>Go back</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    // Bunny or other embeds — use iframe (these allow embedding)
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <View style={[styles.header, { backgroundColor: headerBg, borderBottomColor: isBunnyLive ? '#222' : '#F0F0F0' }]}>
          <Pressable hitSlop={12} onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={24} color={headerTextColor} />
          </Pressable>
          <View style={styles.titleWrap}>
            <View style={[styles.liveDot, isBunnyLive && { backgroundColor: RED }]} />
            <Text style={[styles.headerTitle, { color: headerTextColor }]} numberOfLines={1}>
              {title || 'Live Session'}
            </Text>
          </View>
          <Pressable hitSlop={12} onPress={openInBrowser} style={styles.headerBtn}>
            <Ionicons name="open-outline" size={20} color={headerTextColor} />
          </Pressable>
        </View>
        <View style={{ flex: 1 }}>
          <iframe
            src={embedSrc}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block', backgroundColor: '#000' } as any}
            allow="camera; microphone; display-capture; autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </View>
      </View>
    );
  }

  // ── Native platform ───────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={[styles.header, { backgroundColor: headerBg, borderBottomColor: isBunnyLive ? '#222' : '#F0F0F0' }]}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color={headerTextColor} />
        </Pressable>
        <View style={styles.titleWrap}>
          <View style={[styles.liveDot, isBunnyLive && { backgroundColor: RED }]} />
          <Text style={[styles.headerTitle, { color: headerTextColor }]} numberOfLines={1}>
            {title || 'Live Session'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {!isBunnyLive && (
            <Pressable hitSlop={8} onPress={shareSession} style={styles.headerBtn}>
              <Ionicons name="share-outline" size={20} color={headerTextColor} />
            </Pressable>
          )}
          <Pressable hitSlop={8} onPress={openInBrowser} style={styles.headerBtn}>
            <Ionicons name="open-outline" size={20} color={headerTextColor} />
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={() => { setWebError(false); setLoading(true); webViewRef.current?.reload(); }}
            style={styles.headerBtn}
          >
            <Ionicons name="refresh" size={20} color={headerTextColor} />
          </Pressable>
        </View>
      </View>

      {loading && !webError && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${Math.max(progress * 100, 10)}%` }]} />
        </View>
      )}

      {webError ? (
        <View style={styles.errorContainer}>
          <Ionicons name="globe-outline" size={52} color={C.textTertiary} />
          <Text style={styles.errorTitle}>Couldn't load stream</Text>
          <Text style={styles.errorSub}>Try opening in your browser instead.</Text>
          <Pressable style={styles.openBtn} onPress={openInBrowser}>
            <Ionicons name="open-outline" size={16} color="#FFF" />
            <Text style={styles.openBtnText}>Open in Browser</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 14, color: C.textSecondary }}>Go back</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={
            isBunnyLive
              ? { html: BUNNY_PLAYER_HTML(getEmbedUrl(url || ''), title || ''), baseUrl: 'https://iframe.mediadelivery.net' }
              : { uri: getEmbedUrl(url || '') }
          }
          style={styles.webview}
          originWhitelist={['*']}
          onLoadStart={() => { setLoading(true); setWebError(false); setProgress(0); }}
          onLoadEnd={() => { setLoading(false); setProgress(1); }}
          onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
          onError={() => { setLoading(false); setWebError(true); }}
          onHttpError={() => setLoading(false)}
          javaScriptEnabled
          domStorageEnabled
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          startInLoadingState={false}
          mixedContentMode="always"
          cacheEnabled={true}
        />
      )}

      {loading && !webError && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={RED} />
          <Text style={styles.loadingText}>
            {isBunnyLive ? 'Connecting to live stream...' : 'Opening live session...'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 10,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 4 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: RED },
  headerTitle: { color: C.text, fontSize: 15, fontFamily: 'Inter_700Bold', maxWidth: '80%' },
  progressBar: { height: 3, backgroundColor: '#F0F0F0' },
  progressFill: { height: 3, backgroundColor: RED },
  webview: { flex: 1, backgroundColor: '#000' },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF',
  },
  loadingText: { marginTop: 12, fontSize: 14, color: C.textSecondary, fontFamily: 'Inter_400Regular' },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, backgroundColor: '#FFF' },
  errorTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text, textAlign: 'center' },
  errorSub: { fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20, fontFamily: 'Inter_400Regular' },
  openBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: RED, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 4,
  },
  openBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  ytRedirectContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 16, padding: 32, backgroundColor: '#FFF',
  },
  ytIconCircle: {
    width: 100, height: 100, borderRadius: 50,
    alignItems: 'center', justifyContent: 'center',
  },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: RED + '15', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
  },
  livePillText: { color: RED, fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 1.2 },
  ytTitle: {
    fontSize: 20, fontFamily: 'Inter_700Bold', color: '#111827',
    textAlign: 'center', lineHeight: 28,
  },
  ytSub: {
    fontSize: 14, color: '#6B7280', fontFamily: 'Inter_400Regular',
    textAlign: 'center', lineHeight: 22,
  },
  ytWatchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 32, paddingVertical: 16, borderRadius: 14, marginTop: 4,
  },
  ytWatchBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },
});
