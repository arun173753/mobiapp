import React, { useEffect, useRef, useState } from 'react';
import { NativeEventEmitter, NativeModules, Platform, StyleSheet, View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';

interface DesktopWebViewProps {
  uri: string;
  onLoad?: () => void;
  onError?: () => void;
  onLoadStart?: () => void;
  style?: any;
}

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BEFORE_LOAD_JS = `
(function() {
  var m = document.querySelector('meta[name="viewport"]');
  if (m) {
    m.content = 'width=1024, initial-scale=0.5, user-scalable=yes';
  } else {
    var n = document.createElement('meta');
    n.name = 'viewport';
    n.content = 'width=1024, initial-scale=0.5, user-scalable=yes';
    document.head && document.head.appendChild(n);
  }
  true;
})();
`;

const AFTER_LOAD_JS = `
(function() {
  var s = document.createElement('style');
  s.textContent = 'body { min-width: 1024px; -webkit-overflow-scrolling: touch; }';
  document.head.appendChild(s);
  true;
})();
`;

export default function DesktopWebView({
  uri,
  onLoad,
  onError,
  onLoadStart,
  style,
}: DesktopWebViewProps) {
  const webViewRef = useRef<any>(null);
  const [progress, setProgress] = useState(0);
  const [showBar, setShowBar] = useState(false);

  useEffect(() => {
    // Legacy pushing code removed.
  }, []);
  const handleLoadStart = () => {
    setProgress(0);
    setShowBar(true);
    onLoadStart?.();
  };

  const handleLoadEnd = () => {
    setProgress(1);
    setTimeout(() => setShowBar(false), 300);
    onLoad?.();
  };

  const handleProgress = (e: any) => {
    setProgress(e.nativeEvent.progress);
  };

  return (
    <View style={[styles.container, style]}>
      <RNWebView
        ref={webViewRef}
        source={{ uri }}
        style={styles.webview}
        originWhitelist={['*']}
        onLoadStart={handleLoadStart}
        onLoadEnd={handleLoadEnd}
        onLoadProgress={handleProgress}
        onError={onError}
        onHttpError={onError}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        mediaPlaybackRequiresUserAction={false}
        cacheEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        userAgent={DESKTOP_UA}
        startInLoadingState={true}
        scalesPageToFit
        mixedContentMode="always"
        forceDarkOn={false}
        setSupportZoom={false}
        allowsLinkPreview={false}
        injectedJavaScriptBeforeContentLoaded={BEFORE_LOAD_JS}
        injectedJavaScript={AFTER_LOAD_JS}
        setSupportMultipleWindows={false}
        geolocationEnabled={true}
        {...(Platform.OS === 'android' && {
          nestedScrollEnabled: true,
          scrollEnabled: true,
          overScrollMode: 'never',
          setBuiltInZoomControls: false,
          setDisplayZoomControls: false,
        })}
        {...(Platform.OS === 'ios' && {
          scrollEnabled: true,
          bounces: false,
        })}
      />

      {showBar && (
        <View style={styles.progressBar} pointerEvents="none">
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as any }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  webview: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  progressBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.05)',
    zIndex: 20,
  },
  progressFill: {
    height: 3,
    backgroundColor: '#FF6B2C',
    borderRadius: 2,
  },
});