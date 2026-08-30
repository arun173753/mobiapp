import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { IntroSplashControls } from '@/components/IntroSplashControls';
import {
  cloudflareIntroEmbedUrl,
  getIntroWebPlaybackCandidates,
  INTRO_PLAYBACK_VOLUME,
  isCloudflareIntroUrl,
} from '@/lib/app-intro';

type AppIntroSplashProps = {
  visible: boolean;
  videoUrl: string;
  durationSeconds?: number;
  onDone: () => void;
  onPlaybackFailed?: () => void;
  onPlaybackStarted?: () => void;
};

const DEFAULT_INTRO_SECONDS = 12;

export function AppIntroSplash({
  visible,
  videoUrl,
  durationSeconds = 0,
  onDone,
  onPlaybackStarted,
}: AppIntroSplashProps) {
  const candidates = useMemo(() => getIntroWebPlaybackCandidates(videoUrl), [videoUrl]);
  const cfEmbed = useMemo(
    () => (isCloudflareIntroUrl(videoUrl) ? cloudflareIntroEmbedUrl(videoUrl, true) : null),
    [videoUrl],
  );

  const [useEmbed, setUseEmbed] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [soundOn, setSoundOn] = useState(false);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [hasStarted, setHasStarted] = useState(false);

  const finishedRef = useRef(false);
  const startedNotified = useRef(false);

  const playbackUrl = useEmbed ? '' : candidates[sourceIndex] || '';
  const embedUrl = useMemo(
    () => (cfEmbed ? cloudflareIntroEmbedUrl(videoUrl, !soundOn) : null),
    [cfEmbed, videoUrl, soundOn],
  );

  const effectiveSeconds = durationSeconds > 0 ? durationSeconds : DEFAULT_INTRO_SECONDS;

  const completeIntro = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    try {
      videoEl?.pause();
    } catch {
      /* ignore */
    }
    onDone();
  }, [onDone, videoEl]);

  const notifyStarted = useCallback(() => {
    if (startedNotified.current) return;
    startedNotified.current = true;
    setHasStarted(true);
    onPlaybackStarted?.();
  }, [onPlaybackStarted]);

  const tryNext = useCallback(() => {
    if (useEmbed && cfEmbed) {
      setUseEmbed(false);
      setSourceIndex(0);
      startedNotified.current = false;
      setHasStarted(false);
      return;
    }
    if (sourceIndex + 1 < candidates.length) {
      setSourceIndex((i) => i + 1);
      startedNotified.current = false;
      setHasStarted(false);
    }
  }, [useEmbed, cfEmbed, sourceIndex, candidates.length]);

  const applySound = useCallback(
    (el: HTMLVideoElement | null, on: boolean) => {
      if (!el) return;
      el.muted = !on;
      el.volume = on ? INTRO_PLAYBACK_VOLUME : 0;
      if (on) el.play().catch(() => {});
    },
    [],
  );

  useEffect(() => {
    if (!visible) return;
    setUseEmbed(false);
    setSourceIndex(0);
    setSoundOn(false);
    setHasStarted(false);
    finishedRef.current = false;
    startedNotified.current = false;
  }, [visible, videoUrl, cfEmbed]);

  useEffect(() => {
    if (!visible || useEmbed || !videoEl || !playbackUrl) return;

    let disposed = false;
    let hlsInstance: { destroy: () => void } | null = null;

    const tryPlay = () => {
      videoEl.muted = true;
      videoEl.volume = INTRO_PLAYBACK_VOLUME;
      const p = videoEl.play();
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => {
          if (!disposed) tryNext();
        });
      }
    };

    const onEnded = () => completeIntro();
    const onPlaying = () => notifyStarted();
    const onError = () => {
      if (!disposed) tryNext();
    };

    videoEl.addEventListener('ended', onEnded);
    videoEl.addEventListener('playing', onPlaying);
    videoEl.addEventListener('error', onError);

    (async () => {
      if (/\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(playbackUrl)) {
        videoEl.src = playbackUrl;
        tryPlay();
        return;
      }
      if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = playbackUrl;
        tryPlay();
        return;
      }
      try {
        const HlsModule = await import('hls.js');
        const HlsCtor = HlsModule.default;
        if (HlsCtor.isSupported()) {
          hlsInstance = new HlsCtor({ enableWorker: true });
          hlsInstance.loadSource(playbackUrl);
          hlsInstance.attachMedia(videoEl);
          hlsInstance.on(HlsCtor.Events.MANIFEST_PARSED, () => tryPlay());
          hlsInstance.on(HlsCtor.Events.ERROR, () => onError());
        } else {
          videoEl.src = playbackUrl;
          tryPlay();
        }
      } catch {
        videoEl.src = playbackUrl;
        tryPlay();
      }
    })();

    return () => {
      disposed = true;
      videoEl.removeEventListener('ended', onEnded);
      videoEl.removeEventListener('playing', onPlaying);
      videoEl.removeEventListener('error', onError);
      if (hlsInstance) {
        try {
          hlsInstance.destroy();
        } catch {
          /* ignore */
        }
      }
    };
  }, [visible, useEmbed, videoEl, playbackUrl, completeIntro, notifyStarted, tryNext]);

  useEffect(() => {
    if (!visible || useEmbed || !videoEl) return;
    applySound(videoEl, soundOn);
  }, [soundOn, visible, useEmbed, videoEl, applySound]);

  useEffect(() => {
    if (!visible || !hasStarted) return;
    const t = setTimeout(completeIntro, Math.max(1500, (effectiveSeconds + 0.4) * 1000));
    return () => clearTimeout(t);
  }, [visible, hasStarted, effectiveSeconds, completeIntro]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      {useEmbed && embedUrl
        ? React.createElement('iframe', {
            key: embedUrl,
            src: embedUrl,
            title: 'App intro',
            allow: 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture',
            onLoad: () => notifyStarted(),
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              border: 'none',
              backgroundColor: '#000',
            },
          })
        : React.createElement('video', {
            key: `${playbackUrl}-${sourceIndex}`,
            ref: (el: HTMLVideoElement | null) => setVideoEl(el),
            autoPlay: true,
            muted: true,
            playsInline: true,
            controls: false,
            onEnded: () => completeIntro(),
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              backgroundColor: '#000',
            },
          })}
      <IntroSplashControls
        soundOn={soundOn}
        onToggleSound={() => setSoundOn((v) => !v)}
        onSkip={completeIntro}
      />
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
