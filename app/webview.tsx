import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Colors from '@/constants/colors';
import DesktopWebView from '@/components/DesktopWebView';

const C = Colors.light;

export default function WebViewScreen() {
  const insets = useSafeAreaInsets();
  const { url, title } = useLocalSearchParams<{ url: string; title: string }>();
  const webViewRef = useRef<any>(null);
  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const getEmbedUrl = (rawUrl: string): string => {
    if (!rawUrl) return '';
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
        if (videoId) {
          return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
        }
      }
    } catch {}
    return rawUrl;
  };

  if (Platform.OS === 'web') {
    const embedSrc = getEmbedUrl(url || '');
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
          <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Browser'}</Text>
          <View style={{ width: 36 }} />
        </View>
        <iframe
          src={embedSrc}
          style={{ flex: 1, border: 'none', width: '100%', height: '100%' } as any}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
        />
      </View>
    );
  }

  const [webError, setWebError] = useState(false);
  const [reloading, setReloading] = useState(false);

  const openInBrowser = () => {
    if (url) Linking.openURL(url).catch(() => {});
  };

  const finalUrl = getEmbedUrl(url || '');

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Browser'}</Text>
        <Pressable
          hitSlop={12}
          onPress={() => {
            setWebError(false);
            setReloading(r => !r);
            webViewRef.current?.reload?.();
          }}
          style={styles.backBtn}
        >
          <Ionicons name="refresh" size={22} color={C.text} />
        </Pressable>
      </View>

      {webError ? (
        <View style={styles.errorContainer}>
          <Ionicons name="globe-outline" size={52} color={C.textTertiary} />
          <Text style={styles.errorTitle}>Couldn't open in app</Text>
          <Text style={styles.errorSub}>This page will open in your browser instead.</Text>
          <Pressable style={styles.openBtn} onPress={openInBrowser}>
            <Ionicons name="open-outline" size={16} color="#FFF" />
            <Text style={styles.openBtnText}>Open in Browser</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 14, color: C.textSecondary, fontFamily: 'Inter_400Regular' }}>Go back</Text>
          </Pressable>
        </View>
      ) : (
        <DesktopWebView
          uri={finalUrl}
          onLoadStart={() => setWebError(false)}
          onLoad={() => {}}
          onError={() => setWebError(true)}
          style={styles.webview}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: C.text,
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  webview: {
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
    backgroundColor: C.background,
  },
  errorTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
    textAlign: 'center',
  },
  errorSub: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 4,
  },
  openBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFF',
  },
});
