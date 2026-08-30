import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Audio, ResizeMode, Video, type AVPlaybackStatus } from 'expo-av';
import { WebView } from 'react-native-webview';
import { IntroSplashControls } from '@/components/IntroSplashControls';
import {
  buildIntroWebPlayerHtml,
  cloudflareIntroEmbedUrl,
  getIntroPlaybackCandidates,
  INTRO_PLAYBACK_VOLUME,
  isCloudflareIntroUrl,
} from '@/lib/app-intro';
import { buildExpoAvStreamSource } from '@/lib/stream-video';

const DEFAULT_INTRO_SECONDS = 12;
const MODE_SWITCH_MS = 12000;
const MAX_INTRO_MS = 45000;

type AppIntroSplashProps = {
  visible: boolean;
  videoUrl: string;
  durationSeconds?: number;
  onDone: () => void;
  onPlaybackFailed?: () => void;
  onPlaybackStarted?: () => void;
};

type PlayerMode = 'iframe' | 'html' | 'native';

export function AppIntroSplash({
  visible,
  videoUrl,
  durationSeconds = 0,
  onDone,
  onPlaybackStarted,
}: AppIntroSplashProps) {
  const iframeUrl = useMemo(
    () => (isCloudflareIntroUrl(videoUrl) ? cloudflareIntroEmbedUrl(videoUrl, true) : null),
    [videoUrl],
  );
  const htmlSource = useMemo(() => buildIntroWebPlayerHtml(videoUrl), [videoUrl]);
  const nativeCandidates = useMemo(() => getIntroPlaybackCandidates(videoUrl), [videoUrl]);

  const [mode, setMode] = useState<PlayerMode>('html');
  const [soundOn, setSoundOn] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [nativeIndex, setNativeIndex] = useState(0);

  const webRef = useRef<WebView>(null);
  const videoRef = useRef<Video>(null);
  const finishedRef = useRef(false);
  const startedNotified = useRef(false);

  const effectiveSeconds = durationSeconds > 0 ? durationSeconds : DEFAULT_INTRO_SECONDS;
  const nativeUri = nativeCandidates[nativeIndex] || '';
  const embedUri = useMemo(
    () => (iframeUrl ? cloudflareIntroEmbedUrl(videoUrl, !soundOn) : null),
    [iframeUrl, videoUrl, soundOn],
  );

  const completeIntro = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    videoRef.current?.pauseAsync().catch(() => {});
    onDone();
  }, [onDone]);

  const notifyStarted = useCallback(() => {
    if (startedNotified.current) return;
    startedNotified.current = true;
    setHasStarted(true);
    onPlaybackStarted?.();
  }, [onPlaybackStarted]);

  const advanceMode = useCallback(() => {
    if (mode === 'html') {
      setMode('native');
      setNativeIndex(0);
      setHasStarted(false);
      startedNotified.current = false;
      return;
    }
    if (mode === 'native' && nativeIndex + 1 < nativeCandidates.length) {
      setNativeIndex((i) => i + 1);
      setHasStarted(false);
      startedNotified.current = false;
      return;
    }
    if (mode === 'native' && iframeUrl) {
      setMode('iframe');
      setHasStarted(false);
      startedNotified.current = false;
      return;
    }
    completeIntro();
  }, [mode, nativeIndex, nativeCandidates.length, iframeUrl, completeIntro]);

  const applySound = useCallback(
    (on: boolean) => {
      if (mode === 'html') {
        webRef.current?.injectJavaScript(
          `if(window.setIntroSound)window.setIntroSound(${on ? 'true' : 'false'}); true;`,
        );
      }
      if (mode === 'native') {
        videoRef.current
          ?.setStatusAsync({ volume: INTRO_PLAYBACK_VOLUME, isMuted: !on })
          .then(() => (on ? videoRef.current?.playAsync() : undefined))
          .catch(() => {});
      }
    },
    [mode],
  );

  useEffect(() => {
    if (!visible) return;
    setMode('html');
    setSoundOn(false);
    setHasStarted(false);
    setNativeIndex(0);
    finishedRef.current = false;
    startedNotified.current = false;
  }, [videoUrl, visible, iframeUrl]);

  useEffect(() => {
    if (!visible) return;
    onPlaybackStarted?.();
  }, [visible, onPlaybackStarted]);

  useEffect(() => {
    if (!visible) return;
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    }).catch(() => {});
  }, [visible]);

  useEffect(() => {
    if (!visible || !hasStarted) return;
    const t = setTimeout(completeIntro, Math.max(2000, (effectiveSeconds + 0.4) * 1000));
    return () => clearTimeout(t);
  }, [visible, hasStarted, effectiveSeconds, completeIntro]);

  useEffect(() => {
    if (!visible || hasStarted) return;
    const t = setTimeout(advanceMode, MODE_SWITCH_MS);
    return () => clearTimeout(t);
  }, [visible, hasStarted, mode, nativeIndex, advanceMode]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(completeIntro, MAX_INTRO_MS);
    return () => clearTimeout(t);
  }, [visible, completeIntro]);

  useEffect(() => {
    if (!visible || mode !== 'html') return;
    applySound(soundOn);
  }, [soundOn, visible, mode, applySound]);

  const onWebMessage = useCallback(
    (raw: string) => {
      try {
        const msg = JSON.parse(raw) as { type?: string };
        if (msg.type === 'playing') {
          notifyStarted();
          return;
        }
        if (msg.type === 'ended') {
          completeIntro();
          return;
        }
        if (msg.type === 'failed') {
          advanceMode();
        }
      } catch {
        /* ignore */
      }
    },
    [notifyStarted, completeIntro, advanceMode],
  );

  const onNativeStatus = useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded) {
        if ('error' in status && status.error) advanceMode();
        return;
      }
      if (status.isPlaying) notifyStarted();
      if (status.didJustFinish) completeIntro();
    },
    [advanceMode, notifyStarted, completeIntro],
  );

  useEffect(() => {
    if (mode !== 'native' || !visible || !nativeUri) return;
    const t = setTimeout(() => {
      videoRef.current
        ?.setStatusAsync({ volume: INTRO_PLAYBACK_VOLUME, isMuted: !soundOn })
        .then(() => videoRef.current?.playAsync())
        .then(() => notifyStarted())
        .catch(() => advanceMode());
    }, 120);
    return () => clearTimeout(t);
  }, [mode, visible, nativeUri, soundOn, notifyStarted, advanceMode]);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      setTimeout(() => applySound(next), 0);
      return next;
    });
  }, [applySound]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      {mode === 'iframe' && embedUri ? (
        <WebView
          key={`iframe-${embedUri}`}
          ref={webRef}
          source={{ uri: embedUri }}
          style={StyleSheet.absoluteFill}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowsFullscreenVideo={false}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="always"
          setSupportMultipleWindows={false}
          onLoadEnd={() => notifyStarted()}
          onError={advanceMode}
          onHttpError={advanceMode}
        />
      ) : null}

      {mode === 'html' ? (
        <WebView
          key="html-player"
          ref={webRef}
          source={{ html: htmlSource.html, baseUrl: htmlSource.baseUrl }}
          style={StyleSheet.absoluteFill}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowsFullscreenVideo={false}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="always"
          setSupportMultipleWindows={false}
          onMessage={(e) => onWebMessage(e.nativeEvent.data)}
          onError={advanceMode}
          onHttpError={advanceMode}
        />
      ) : null}

      {mode === 'native' && nativeUri ? (
        <Video
          key={`${nativeUri}-${nativeIndex}`}
          ref={videoRef}
          source={buildExpoAvStreamSource(nativeUri)}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.COVER}
          shouldPlay={false}
          isLooping={false}
          volume={INTRO_PLAYBACK_VOLUME}
          isMuted={!soundOn}
          progressUpdateIntervalMillis={350}
          onPlaybackStatusUpdate={onNativeStatus}
        />
      ) : null}

      <IntroSplashControls soundOn={soundOn} onToggleSound={toggleSound} onSkip={completeIntro} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    backgroundColor: '#000000',
  },
});
