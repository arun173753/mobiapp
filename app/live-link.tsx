import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform, Alert, Linking, Dimensions } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const RED = '#EF4444';

export default function LiveLinkScreen() {
  const insets = useSafeAreaInsets();
  const routeParams = useLocalSearchParams<{ link: string; title: string }>();
  
  // Get link and title from route params or URL query params
  let link = routeParams.link;
  let title = routeParams.title;
  
  // On web, also check URL query params
  if (Platform.OS === 'web') {
    const params = new URLSearchParams(window.location.search);
    link = link || params.get('link') || '';
    title = title || params.get('title') || 'View Content';
  }
  
  const [loading, setLoading] = useState(true);
  const safeLink = typeof link === 'string' ? link : '';

  if (!safeLink) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </Pressable>
          <Text style={styles.headerTitle}>Live Link</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color={RED} />
          <Text style={styles.errorText}>No link available</Text>
        </View>
      </View>
    );
  }

  const isWeb = Platform.OS === 'web';

  if (isWeb) {
    const isDesktop = Dimensions.get('window').width > 800;
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={[styles.header, isDesktop && styles.headerDesktop]}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Live Session'}</Text>
            <Pressable style={styles.openBtn} onPress={() => Linking.openURL(safeLink).catch(() => {})}>
            <Ionicons name="open-outline" size={20} color={RED} />
          </Pressable>
        </View>
        <View style={[styles.contentWrapper, isDesktop && styles.contentWrapperDesktop]}>
          <iframe
            src={safeLink}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              borderRadius: isDesktop ? '8px' : 0,
              boxShadow: isDesktop ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
            }}
            allow="camera; microphone; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            sandbox="allow-same-origin allow-scripts allow-forms allow-presentation allow-modals"
          />
        </View>
      </View>
    );
  }

  // Mobile: Use WebView
  const handleWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'link') {
        // User clicked a link - open it in browser or show dialog
        Alert.alert(
          'Open Link',
          'This will open in your browser',
          [
            { text: 'Cancel', onPress: () => {} },
            { 
              text: 'Open', 
              onPress: () => {
                Linking.openURL(data.href).catch(() => {});
              }
            }
          ]
        );
      }
    } catch (e) {
      console.error('Error parsing WebView message:', e);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Live Session'}</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={RED} />
        </View>
      )}
      <WebView
        source={{ uri: safeLink }}
        style={{ flex: 1 }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => setLoading(false)}
        onHttpError={() => setLoading(false)}
        startInLoadingState={false}
        allowsFullscreenVideo
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        cacheEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        renderToHardwareTextureAndroid
        decelerationRate="normal"
        allowsBackForwardNavigationGestures
        mixedContentMode="always"
          setSupportMultipleWindows={false}
        {...(Platform.OS === 'android' && {
          overScrollMode: 'never' as any,
          setBuiltInZoomControls: false,
        })}
        {...(Platform.OS === 'ios' && {
          bounces: false,
        })}
          onShouldStartLoadWithRequest={(request) => {
            const requestUrl = request.url;
            if (requestUrl === safeLink) return true;
            if (requestUrl.startsWith('about:blank')) return true;
            if (requestUrl.startsWith('data:')) return true;
            return requestUrl.startsWith('http://') || requestUrl.startsWith('https://');
          }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    backgroundColor: '#FFF',
  },
  headerDesktop: {
    paddingHorizontal: 40,
    paddingVertical: 16,
  },
  contentWrapper: { flex: 1 },
  contentWrapperDesktop: {
    maxWidth: 1200,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F2F2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  openBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF5F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#000', flex: 1, textAlign: 'center' },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#666' },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
