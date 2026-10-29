import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  ActivityIndicator,
  Dimensions,
  Alert,
  ScrollView,
} from 'react-native';
import { Video, ResizeMode, Audio } from 'expo-av';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp, FadeOut } from 'react-native-reanimated';
import { Image } from 'expo-image';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest } from '@/lib/query-client';
import { openRazorpayCheckoutWeb } from '@/lib/razorpay-web';
import { openRazorpayCheckoutNative } from '@/lib/razorpay-native';
import type { SubStatus, SubscriptionPlan } from '@/lib/subscription-status';
import { ROLE_LABELS, UserRole, isAdminUser } from '@/lib/types';
import {
  buildExpoAvStreamSource,
  cloudflareStreamMp4Fallback,
} from '@/lib/stream-video';
import { buildIntroWebPlayerHtml, getIntroWebPlaybackCandidates, getIntroPlaybackCandidates, INTRO_PLAYBACK_VOLUME } from '@/lib/app-intro';
import SubscriptionContentEditModal from '@/components/SubscriptionContentEditModal';
import {
  uploadSubscriptionPaywallPhoto,
  type PaywallMatter,
} from '@/lib/subscription-content-api';

const C = Colors.dark;
const { width: SCREEN_W } = Dimensions.get('window');
const FREE_TRIAL_PLAN_ID = 'tap_start_trial';
const FONT = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

function isFreeTrialPlan(plan: { id?: string; key?: string; isTrial?: boolean; price?: number } | null | undefined): boolean {
  if (!plan) return false;
  if (plan.isTrial === true) return true;
  const id = String(plan.id || '');
  const key = String((plan as { key?: string }).key || '');
  return id === FREE_TRIAL_PLAN_ID || key === 'trial';
}

export type SubscriptionPaywallContentProps = {
  /** When true, shows top bar with close and optional notice (modal route). */
  standalone?: boolean;
  /** e.g. trial expiry message */
  topNotice?: string;
  onRequestClose?: () => void;
  /** When parent already fetched subscription status (e.g. lock screen), skip initial blank load. */
  hydratedStatus?: SubStatus | null;
  /** Pay/subscribe for a role other than the signed-in profile role (e.g. customer → hotel_owner). */
  targetRole?: string;
  /** Let the lock screen unlock immediately after trial/payment without waiting for its poll. */
  onStatusChange?: (status: SubStatus) => void;
};

const VideoPreviewCard = React.memo(function VideoPreviewCard({
  url,
  onError,
}: {
  url: string;
  onError: () => void;
}) {
  const videoRef = useRef<Video | null>(null);
  const webViewRef = useRef<WebView | null>(null);
  const [webVideoEl, setWebVideoEl] = useState<HTMLVideoElement | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [useHtmlPlayer, setUseHtmlPlayer] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const cardWidth = Math.min(SCREEN_W - 48, 360);
  const cardHeight = Math.round((cardWidth * 9) / 16);

  const htmlPlayer = useMemo(
    () => buildIntroWebPlayerHtml(url, { objectFit: 'contain', loop: true }),
    [url],
  );
  const candidates = useMemo(() => getIntroWebPlaybackCandidates(url), [url]);
  const playbackUrl = candidates[sourceIndex] || '';
  const mp4Src = useMemo(() => cloudflareStreamMp4Fallback(url), [url]);
  const fileSrc = useMemo(() => {
    const trimmed = (url || '').trim();
    if (/\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(trimmed)) return trimmed;
    return mp4Src || trimmed;
  }, [url, mp4Src]);

  useEffect(() => {
    setFailed(false);
    setIsReady(false);
    setSoundOn(false);
    setUseHtmlPlayer(false);
    setSourceIndex(0);
  }, [url]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    }).catch(() => {});
  }, [url]);

  const avUri = useMemo(
    () => getIntroPlaybackCandidates(url)[0] || fileSrc || url,
    [url, fileSrc],
  );

  const markReady = useCallback(() => setIsReady(true), []);
  const markFailed = useCallback(() => {
    if (!useHtmlPlayer && Platform.OS !== 'web') {
      setUseHtmlPlayer(true);
      setIsReady(false);
      return;
    }
    setFailed(true);
    onError();
  }, [onError, useHtmlPlayer]);

  const tryNextWebSource = useCallback(() => {
    setSourceIndex((i) => {
      if (i + 1 < candidates.length) {
        setIsReady(false);
        return i + 1;
      }
      setFailed(true);
      onError();
      return i;
    });
  }, [candidates.length, onError]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !webVideoEl || !playbackUrl || failed) return;

    let disposed = false;
    let hlsInstance: { destroy: () => void } | null = null;

    const tryPlay = () => {
      if (disposed) return;
      webVideoEl.loop = true;
      webVideoEl.muted = true;
      webVideoEl.volume = INTRO_PLAYBACK_VOLUME;
      const p = webVideoEl.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          if (!disposed) tryNextWebSource();
        });
      }
    };

    const onPlaying = () => {
      if (!disposed) markReady();
    };
    const onError = () => {
      if (!disposed) tryNextWebSource();
    };

    webVideoEl.addEventListener('playing', onPlaying);
    webVideoEl.addEventListener('canplay', onPlaying);
    webVideoEl.addEventListener('error', onError);

    (async () => {
      const isFile = /\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(playbackUrl);
      if (isFile || webVideoEl.canPlayType('application/vnd.apple.mpegurl')) {
        webVideoEl.src = playbackUrl;
        tryPlay();
        return;
      }
      try {
        const HlsModule = await import('hls.js');
        const HlsCtor = HlsModule.default;
        if (HlsCtor.isSupported()) {
          hlsInstance = new HlsCtor({ enableWorker: true });
          hlsInstance.loadSource(playbackUrl);
          hlsInstance.attachMedia(webVideoEl);
          hlsInstance.on(HlsCtor.Events.MANIFEST_PARSED, () => tryPlay());
          hlsInstance.on(HlsCtor.Events.ERROR, (_: unknown, data: { fatal?: boolean }) => {
            if (data?.fatal && !disposed) tryNextWebSource();
          });
          return;
        }
      } catch {
        /* fall through */
      }
      webVideoEl.src = playbackUrl;
      tryPlay();
    })();

    return () => {
      disposed = true;
      webVideoEl.removeEventListener('playing', onPlaying);
      webVideoEl.removeEventListener('canplay', onPlaying);
      webVideoEl.removeEventListener('error', onError);
      if (hlsInstance) {
        try {
          hlsInstance.destroy();
        } catch {
          /* ignore */
        }
      }
    };
  }, [webVideoEl, playbackUrl, failed, markReady, tryNextWebSource]);

  const applySound = useCallback((on: boolean) => {
    try {
      if (Platform.OS !== 'web') {
        void Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
      }
      if (webVideoEl) {
        webVideoEl.muted = !on;
        webVideoEl.volume = on ? INTRO_PLAYBACK_VOLUME : 0;
        if (on) void webVideoEl.play().catch(() => {});
      }
      webViewRef.current?.injectJavaScript(
        `(function(){try{if(window.setIntroSound)window.setIntroSound(${on ? 'true' : 'false'});var v=document.getElementById('v');if(v){v.muted=${on ? 'false' : 'true'};if(${on ? 'true' : 'false'}){v.volume=1;v.play();}} }catch(e){} true;})();`,
      );
      void videoRef.current?.setStatusAsync({
        isMuted: !on,
        volume: on ? 1 : 0,
        shouldPlay: true,
      });
    } catch {
      /* ignore */
    }
  }, [webVideoEl]);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      applySound(next);
      return next;
    });
  }, [applySound]);

  useEffect(() => {
    if (!isReady) return;
    applySound(soundOn);
  }, [isReady, soundOn, applySound]);

  if (!url || failed) {
    return (
      <View style={[styles.videoWrap, { width: cardWidth, height: cardHeight }]}>
        <View style={styles.videoFallback}>
          <Ionicons name="videocam-off-outline" size={26} color="rgba(255,255,255,0.55)" />
          <Text style={styles.videoFallbackText}>Preview unavailable</Text>
        </View>
      </View>
    );
  }

  const renderPlayer = () => {
    if (Platform.OS === 'web') {
      return React.createElement('video', {
        key: `${playbackUrl}-${sourceIndex}`,
        ref: (el: HTMLVideoElement | null) => setWebVideoEl(el),
        autoPlay: true,
        muted: true,
        loop: true,
        playsInline: true,
        controls: false,
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          backgroundColor: '#000',
        },
      });
    }
    if (useHtmlPlayer) {
      return (
        <WebView
          ref={webViewRef}
          source={{ html: htmlPlayer.html, baseUrl: htmlPlayer.baseUrl }}
          style={{ width: cardWidth, height: cardHeight, backgroundColor: '#000' }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowsFullscreenVideo={false}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="always"
          setSupportMultipleWindows={false}
          scrollEnabled={false}
          nestedScrollEnabled={false}
          onMessage={(e) => {
            try {
              const msg = JSON.parse(String(e.nativeEvent.data || '{}')) as { type?: string };
              if (msg.type === 'playing') markReady();
              if (msg.type === 'failed') markFailed();
            } catch {
              /* ignore */
            }
          }}
          onError={markFailed}
        />
      );
    }
    return (
      <Video
        ref={(r) => { videoRef.current = r; }}
        source={buildExpoAvStreamSource(avUri)}
        style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay
        isLooping
        isMuted={!soundOn}
        volume={1}
        useNativeControls={false}
        onReadyForDisplay={markReady}
        onError={markFailed}
      />
    );
  };

  return (
    <Animated.View
      entering={Platform.OS === 'web' ? undefined : FadeInDown.duration(260)}
      exiting={Platform.OS === 'web' ? undefined : FadeOut.duration(180)}
      style={[styles.videoWrap, { width: cardWidth, height: cardHeight }]}
    >
      <View style={[styles.videoInner, { width: cardWidth, height: cardHeight }]}>
        {renderPlayer()}
        {!isReady ? (
          <View pointerEvents="none" style={styles.videoLoadingOverlay}>
            <ActivityIndicator size="small" color="#FFD60A" />
            <Text style={styles.videoLoadingText}>Loading video…</Text>
          </View>
        ) : null}
        <View style={styles.videoControlsRow} pointerEvents="box-none">
          <Pressable style={styles.videoControlBtn} onPress={toggleSound} hitSlop={8}>
            <Ionicons name={soundOn ? 'volume-high' : 'volume-mute'} size={18} color="#111" />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
});

export default function SubscriptionPaywallContent({
  standalone,
  topNotice,
  onRequestClose,
  hydratedStatus,
  targetRole,
  onStatusChange,
}: SubscriptionPaywallContentProps) {
  const { profile, refreshData, setProfile } = useApp();
  const insets = useSafeAreaInsets();
  const isAdmin = isAdminUser(profile);
  const [status, setStatus] = useState<SubStatus | null>(hydratedStatus ?? null);
  const [loading, setLoading] = useState(!hydratedStatus);
  const [paying, setPaying] = useState(false);
  const [startingTrial, setStartingTrial] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editMatterOpen, setEditMatterOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const statusRef = useRef<SubStatus | null>(status);
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const billingRole = useMemo(() => {
    const t = String(targetRole || '').trim().toLowerCase();
    if (t) return t;
    const profileRole = String(profile?.role || '').trim().toLowerCase();
    if (isAdmin && profileRole !== 'technician') return 'technician';
    return profileRole;
  }, [targetRole, profile?.role, isAdmin]);

  const checkStatus = useCallback(async (background = false) => {
    if (!profile?.id) {
      setLoading(false);
      setLoadError('Sign in required to view subscription plans.');
      return;
    }
    if (!background && !statusRef.current) {
      setLoading(true);
    }
    setLoadError(null);
    try {
      const qs = billingRole ? `?forRole=${encodeURIComponent(billingRole)}` : '';
      const res = await apiRequest('GET', `/api/subscription/status/${profile.id}${qs}`);
      const data = await res.json();
      if (data && typeof data === 'object') {
        const next = { success: true, required: data.required ?? true, ...data };
        setStatus(next);
        onStatusChangeRef.current?.(next);
        const activePlans = Array.isArray(data.plans) ? data.plans : [];
        setSelectedPlanId((prev) => {
          const paid = activePlans.filter((p: SubscriptionPlan) => !isFreeTrialPlan(p));
          if (prev && paid.some((p: SubscriptionPlan) => p.id === prev)) return prev;
          return paid[0]?.id || null;
        });
      } else {
        setLoadError('Could not load subscription plans.');
      }
    } catch (e: any) {
      const msg = e?.message || 'Could not load subscription plans.';
      console.warn('[Sub] Check failed:', e);
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, billingRole]);

  useEffect(() => {
    if (hydratedStatus) {
      setStatus(hydratedStatus);
      setLoading(false);
    }
  }, [hydratedStatus]);

  useEffect(() => {
    void checkStatus(false);
    const interval = setInterval(() => void checkStatus(true), 30000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const finishAfterPay = useCallback(async (subscriptionEnd?: number) => {
    const end = Number(subscriptionEnd || 0);
    if (profile && end > Date.now()) {
      await setProfile({
        ...profile,
        subscriptionActive: 1,
        subscriptionEnd: end,
      });
    }
    await refreshData().catch(() => {});
    void checkStatus(true);
    setTimeout(() => void checkStatus(true), 5000);
    setTimeout(() => void checkStatus(true), 15000);
    setTimeout(() => void checkStatus(true), 30000);
    const close = onRequestClose;
    if (Platform.OS === 'web') {
      window.alert('Payment successful. Subscription is active.');
      close?.();
    } else {
      Alert.alert('Payment successful', 'Your subscription is now active.', [
        { text: 'OK', onPress: () => close?.() },
      ]);
    }
  }, [checkStatus, onRequestClose, profile, refreshData, setProfile]);

  const handleStartTrial = async () => {
    if (!profile?.id || startingTrial) return;
    setStartingTrial(true);
    try {
      const res = await apiRequest('POST', '/api/subscription/trial/start', {
        forRole: billingRole,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const msg = data.message || 'Could not start trial.';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Trial', msg);
        return;
      }
      const days = Number(data.trialDays || status?.trialDays || 1);
      const trialEnd = Number(data.trialEnd || 0);
      const next: SubStatus = {
        ...(status || { required: true, active: false }),
        required: true,
        active: false,
        trialActive: true,
        trialEligible: false,
        trialUsed: true,
        trialStart: Number(data.trialStart || Date.now()),
        trialEnd,
        trialEndsAt: trialEnd,
        trialDays: days,
        accessAllowed: true,
      };
      setStatus(next);
      onStatusChangeRef.current?.(next);
      if (profile) {
        void setProfile({
          ...profile,
          subscriptionActive: 1,
          subscriptionEnd: trialEnd,
          trialEnd,
        });
      }
      await refreshData().catch(() => {});
      await checkStatus(true);
      const ok = `Your ${days}-day trial is on. Use the app as usual.`;
      if (Platform.OS === 'web') window.alert(ok);
      else Alert.alert('Trial started', ok, [{ text: 'OK', onPress: () => onRequestClose?.() }]);
      if (Platform.OS === 'web') onRequestClose?.();
    } catch (e: any) {
      const msg = e?.message || 'Could not start trial.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Trial', msg);
    } finally {
      setStartingTrial(false);
    }
  };

  const handlePay = async () => {
    if (!profile?.id) return;
    const selectedPlan = (status?.plans || []).find((p) => p.id === selectedPlanId) || null;
    if (selectedPlanId === FREE_TRIAL_PLAN_ID || isFreeTrialPlan(selectedPlan)) {
      await handleStartTrial();
      return;
    }
    if (!selectedPlan) {
      const msg = 'Please select a subscription plan.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Subscription', msg);
      return;
    }
    setPaying(true);
    try {
      const roleForPay = billingRole;
      const res = await apiRequest('POST', '/api/payment/create-order', {
        type: 'subscription',
        role: roleForPay,
        referenceId: profile.id,
        planId: selectedPlan.id,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const msg = data.message || `Could not start payment (${res.status})`;
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Payment', msg);
        return;
      }
      if (data.trialStarted || data.skipCheckout) {
        const days = Number(data.trialDays || status?.trialDays || 1);
        const trialEnd = Number(data.trialEnd || 0);
        const next: SubStatus = {
          ...(status || { required: true, active: false }),
          required: true,
          active: false,
          trialActive: true,
          trialEligible: false,
          trialUsed: true,
          trialEnd,
          trialEndsAt: trialEnd,
          trialDays: days,
          accessAllowed: true,
        };
        setStatus(next);
        onStatusChangeRef.current?.(next);
        if (profile) {
          void setProfile({
            ...profile,
            subscriptionActive: 1,
            subscriptionEnd: trialEnd,
            trialEnd,
          });
        }
        await refreshData().catch(() => {});
        await checkStatus(true);
        const ok = data.message || `Your ${days}-day trial is on. Use the app as usual.`;
        if (Platform.OS === 'web') window.alert(ok);
        else Alert.alert('Trial started', ok, [{ text: 'OK', onPress: () => onRequestClose?.() }]);
        if (Platform.OS === 'web') onRequestClose?.();
        return;
      }
      const openCheckout = Platform.OS === 'web' ? openRazorpayCheckoutWeb : openRazorpayCheckoutNative;
      const resp = await openCheckout({
        key: data.keyId,
        order_id: data.id,
        amount: data.amount,
        currency: 'INR',
        name: 'AtoZ Mobile Repair',
        description: `${selectedPlan.duration} Subscription`,
        prefill: {
          name: profile.name || '',
          email: profile.email || '',
          contact: profile.phone || '',
        },
        theme: { color: '#FF6B35' },
      });

      const verifyRes = await apiRequest('POST', '/api/payment/verify', {
        razorpay_order_id: resp.razorpay_order_id,
        razorpay_payment_id: resp.razorpay_payment_id,
        razorpay_signature: resp.razorpay_signature,
        type: 'subscription',
        role: roleForPay,
        referenceId: profile.id,
        planId: selectedPlan.id,
      });
      const verify = await verifyRes.json();
      if (!verify.success) throw new Error(verify.message || 'Verification failed');
      await finishAfterPay(Number(verify.subscriptionEnd || 0));
    } catch (e: any) {
      console.warn('[Sub] Payment failed:', e);
      const msg = e?.message || 'Payment could not be completed. Please try again.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Payment', msg);
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  if (loadError || !status) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: insets.top, paddingHorizontal: 24 }]}>
        {standalone ? (
          <Pressable onPress={onRequestClose} hitSlop={12} style={[styles.backBtn, { alignSelf: 'flex-start', marginBottom: 16 }]}>
            <Ionicons name="chevron-down" size={28} color="#FFF" />
          </Pressable>
        ) : null}
        <Ionicons name="alert-circle-outline" size={48} color={C.primary} />
        <Text style={[styles.modalHeaderTitle, { marginTop: 16, textAlign: 'center' }]}>
          {loadError || 'Could not load subscription'}
        </Text>
        <Pressable
          onPress={() => void checkStatus(false)}
          style={[styles.payButton, { marginTop: 24, alignSelf: 'stretch' }]}
        >
          <Text style={styles.payButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const roleLabel = ROLE_LABELS[status.role as UserRole] || status.role || 'Provider';
  const webTopInset = Platform.OS === 'web' ? 67 : 0;
  const plans = (status.plans || []).filter(
    (p) => p && (p.isActive === undefined || p.isActive === true || p.isActive === 1),
  );
  const content = status.content || {
    title: 'Subscription Required',
    subtitle: `${roleLabel} plan required to access all features`,
    buttonText: 'Subscribe Now',
  };
  const applyPaywallMatter = (next: PaywallMatter) => {
    setStatus((prev) =>
      prev
        ? {
            ...prev,
            content: {
              ...(prev.content || {}),
              title: next.title,
              subtitle: next.subtitle,
              buttonText: next.buttonText,
              bodyText: next.bodyText,
              featuresText: next.featuresText,
              imageUrls: next.imageUrls,
            },
          }
        : prev,
    );
  };
  const handleAddPhotos = async () => {
    setPhotoBusy(true);
    try {
      const next = await uploadSubscriptionPaywallPhoto();
      if (next) applyPaywallMatter(next);
    } catch (e: any) {
      const msg = e?.message || 'Could not add photo.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Photo', msg);
    } finally {
      setPhotoBusy(false);
    }
  };
  const showVideo = Boolean(String(content.videoUrl || '').trim());
  const photoUrls = Array.isArray((content as any).imageUrls) ? (content as any).imageUrls.filter(Boolean) : [];
  const bodyText = String((content as any).bodyText || '').trim();
  const customFeatures = String((content as any).featuresText || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((line) => !/\bspare\s*part/i.test(line) && !/\bschematic/i.test(line));
  const trialDaysShown = Number(status.trialDays || (content as { trialDays?: number }).trialDays || 0);
  const trialOn =
    status.trialEnabled === true ||
    (status as { trialEnabled?: number }).trialEnabled === 1 ||
    Number((content as { trialEnabled?: number }).trialEnabled) === 1 ||
    (status.plans || []).some((p) => isFreeTrialPlan(p));
  const showStartTrial =
    trialDaysShown > 0 &&
    (Boolean(status.trialEligible) || (trialOn && !status.trialActive && (isAdmin || !status.trialUsed)));
  const paidPlans = plans.filter((p) => !isFreeTrialPlan(p));
  const selectedPlan = paidPlans.find((p) => p.id === selectedPlanId) || null;
  const subscribeLabel = selectedPlan
    ? `${content.buttonText || 'Subscribe Now'}  ·  ₹${selectedPlan.price}`
    : content.buttonText || 'Subscribe Now';

  const headerPad = standalone ? insets.top + 8 : 0;

  return (
    <View style={styles.overlay}>
      {standalone ? (
        <Animated.View entering={Platform.OS === 'web' ? undefined : FadeInUp.duration(280)} style={[styles.modalHeader, { paddingTop: headerPad }]}>
          <Pressable
            onPress={onRequestClose}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="chevron-down" size={28} color="#FFF" />
          </Pressable>
          <Text style={styles.modalHeaderTitle}>Subscription</Text>
          <View style={{ width: 40 }} />
        </Animated.View>
      ) : null}

      {topNotice ? (
        <Animated.View entering={Platform.OS === 'web' ? undefined : FadeInDown.delay(standalone ? 40 : 0).duration(260)} style={styles.noticeStrip}>
          <Ionicons name="alert-circle" size={18} color="#111" />
          <Text style={styles.noticeText}>{topNotice}</Text>
        </Animated.View>
      ) : null}

      {isAdmin ? (
        <View style={styles.adminBar}>
          <Pressable style={styles.adminChip} onPress={() => setEditMatterOpen(true)}>
            <Ionicons name="create-outline" size={16} color="#111" />
            <Text style={styles.adminChipText}>Edit matter</Text>
          </Pressable>
          <Pressable style={styles.adminChip} onPress={() => void handleAddPhotos()} disabled={photoBusy}>
            {photoBusy ? (
              <ActivityIndicator size="small" color="#111" />
            ) : (
              <Ionicons name="image-outline" size={16} color="#111" />
            )}
            <Text style={styles.adminChipText}>{photoBusy ? 'Uploading…' : 'Add photos'}</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        style={styles.darkOverlay}
        nestedScrollEnabled
        contentContainerStyle={[
          styles.darkOverlayContent,
          {
            paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + (standalone ? 12 : 28),
            paddingBottom: insets.bottom + 28,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {showVideo ? (
          <VideoPreviewCard
            url={String(content.videoUrl || '')}
            onError={() => setVideoFailed(true)}
          />
        ) : null}

        {photoUrls.length ? (
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.photoStrip}
            style={styles.photoStripWrap}
          >
            {photoUrls.map((url: string) => (
              <Image key={url} source={{ uri: url }} style={styles.paywallPhoto} contentFit="cover" />
            ))}
          </ScrollView>
        ) : null}

        <Animated.View entering={Platform.OS === 'web' ? undefined : FadeInDown.delay(80).duration(340)}>
          <View style={styles.lockIconContainer}>
            <View style={styles.lockCircle}>
              <Ionicons name="lock-closed" size={48} color="#FF6B35" />
            </View>
          </View>

          {String(content.title || '').trim() ? (
            <Text style={styles.lockTitle}>{content.title}</Text>
          ) : null}
          {String(content.subtitle || '').trim() ? (
            <Text style={styles.lockSubtitle}>{content.subtitle}</Text>
          ) : null}
          {bodyText ? <Text style={styles.lockBody}>{bodyText}</Text> : null}

          {trialOn && trialDaysShown > 0 ? (
            <View style={styles.trialCard}>
              <View style={styles.trialCardTop}>
                <View style={styles.trialIconWrap}>
                  <Ionicons name="gift" size={22} color="#111" />
                </View>
                <View style={styles.trialCardCopy}>
                  <Text style={styles.trialCardTitle}>{trialDaysShown}-day free trial</Text>
                  <Text style={styles.trialCardSub}>
                    {status.trialActive
                      ? 'Your trial is already on'
                      : status.trialUsed && !isAdmin
                        ? 'Trial already used on this account'
                        : 'Full access · once per user'}
                  </Text>
                </View>
              </View>
              {showStartTrial ? (
                <Pressable
                  style={[styles.trialCardBtn, startingTrial && styles.payButtonDisabled]}
                  onPress={() => void handleStartTrial()}
                  disabled={startingTrial || paying}
                >
                  {startingTrial ? (
                    <ActivityIndicator size="small" color="#111" />
                  ) : (
                    <Text style={styles.trialCardBtnText}>Start free trial</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={styles.planCard}>
            <View style={styles.planHeader}>
              <Ionicons name="diamond" size={22} color="#FFD60A" />
              <Text style={styles.planName}>{roleLabel} plans</Text>
            </View>

            <View style={styles.planOptions}>
              {paidPlans.length === 0 ? (
                <Text style={styles.emptyPlans}>
                  No paid plans yet. Add them in Admin → Subscriptions.
                </Text>
              ) : null}
              {paidPlans.map((plan) => {
                const selected = plan.id === selectedPlanId;
                const popular = plan.isPopular === true || plan.isPopular === 1;
                return (
                  <Pressable
                    key={plan.id}
                    style={[styles.planOption, selected && styles.planOptionSelected]}
                    onPress={() => setSelectedPlanId(plan.id)}
                  >
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={selected ? '#FF6B35' : '#8E8E93'}
                      style={styles.planRadio}
                    />
                    <View style={styles.planCopy}>
                      <Text style={styles.planOptionTitle} numberOfLines={2}>
                        {plan.duration}
                      </Text>
                      <Text style={styles.planOptionPrice}>₹{plan.price}</Text>
                    </View>
                    {popular ? (
                      <View style={styles.popularChip}>
                        <Text style={styles.popularChipText}>Popular</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            {customFeatures.length ? (
              <View style={styles.featuresList}>
                {customFeatures.map((text) => <FeatureItem key={text} text={text} />)}
              </View>
            ) : null}
          </View>

          <Pressable
            style={[styles.payButton, paying && styles.payButtonDisabled]}
            onPress={handlePay}
            disabled={paying || startingTrial || !selectedPlan}
          >
            {paying ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.payButtonText}>{subscribeLabel}</Text>
            )}
          </Pressable>

          <Text style={styles.securedBy}>{'\uD83D\uDD12'} Secured by Razorpay</Text>

          <Pressable onPress={() => void checkStatus(true)} style={styles.refreshLink}>
            <Ionicons name="refresh" size={16} color={C.textSecondary} />
            <Text style={styles.refreshText}>Already paid? Tap to refresh</Text>
          </Pressable>

        </Animated.View>
      </ScrollView>
      <SubscriptionContentEditModal
        inline
        visible={editMatterOpen}
        initial={status.content || null}
        onClose={() => setEditMatterOpen(false)}
        onSaved={applyPaywallMatter}
      />
    </View>
  );
}

function FeatureItem({ text }: { text: string }) {
  return (
    <View style={styles.featureItem}>
      <Ionicons name="checkmark-circle" size={18} color="#34C759" style={styles.featureIcon} />
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#0A0A0A',
    position: 'relative',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalHeaderTitle: {
    fontSize: 17,
    lineHeight: 24,
    fontFamily: FONT.bold,
    color: '#FFF',
    includeFontPadding: false,
  },
  noticeStrip: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#FFD60A',
  },
  noticeText: {
    flex: 1,
    minWidth: 0,
    color: '#111',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT.bold,
    includeFontPadding: false,
  },
  adminBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  adminChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFD60A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  adminChipText: {
    color: '#111',
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT.bold,
    includeFontPadding: false,
  },
  photoStripWrap: {
    width: '100%',
    maxWidth: 360,
    marginBottom: 16,
    flexGrow: 0,
  },
  photoStrip: {
    gap: 10,
    paddingRight: 8,
  },
  paywallPhoto: {
    width: 220,
    height: 148,
    borderRadius: 14,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  darkOverlay: {
    flex: 1,
  },
  darkOverlayContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  videoWrap: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#111',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  videoInner: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    position: 'relative',
  },
  videoControlsRow: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    gap: 8,
  },
  videoControlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,214,10,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  videoFallback: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#111',
  },
  videoFallbackText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONT.semibold,
    includeFontPadding: false,
  },
  videoLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)',
    gap: 8,
  },
  videoLoadingText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONT.semibold,
    includeFontPadding: false,
  },
  muteOverlay: {
    position: 'absolute',
    right: 10,
    top: 10,
  },
  muteBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,214,10,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  lockIconContainer: {
    marginBottom: 20,
  },
  lockCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,107,53,0.12)',
    borderWidth: 2,
    borderColor: 'rgba(255,107,53,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockTitle: {
    fontSize: 24,
    lineHeight: 32,
    fontFamily: FONT.bold,
    color: '#FFF',
    marginBottom: 8,
    textAlign: 'center',
    paddingHorizontal: 8,
    width: '100%',
    maxWidth: 360,
    includeFontPadding: false,
  },
  lockSubtitle: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 22,
    fontFamily: FONT.regular,
    width: '100%',
    maxWidth: 360,
    paddingHorizontal: 8,
    includeFontPadding: false,
  },
  lockBody: {
    fontSize: 14,
    color: '#D1D1D6',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
    fontFamily: FONT.regular,
    width: '100%',
    maxWidth: 360,
    paddingHorizontal: 8,
    includeFontPadding: false,
  },
  trialCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFD60A',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  trialCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  trialIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  trialCardCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  trialCardTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: FONT.bold,
    color: '#111',
    includeFontPadding: false,
  },
  trialCardSub: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT.regular,
    color: '#3A3A3C',
    marginTop: 4,
    includeFontPadding: false,
  },
  trialCardBtn: {
    marginTop: 14,
    backgroundColor: '#111',
    borderRadius: 12,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  trialCardBtnText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: FONT.bold,
    color: '#FFD60A',
    includeFontPadding: false,
  },
  planCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    padding: 18,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 20,
  },
  planOptions: {
    marginBottom: 16,
  },
  planOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 10,
  },
  planOptionSelected: {
    borderColor: '#FF6B35',
    backgroundColor: 'rgba(255,107,53,0.12)',
  },
  planRadio: {
    marginRight: 10,
  },
  planCopy: {
    flex: 1,
    minWidth: 0,
  },
  planOptionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: FONT.bold,
    color: '#FFF',
    includeFontPadding: false,
  },
  planOptionPrice: {
    fontSize: 14,
    lineHeight: 18,
    color: '#FF6B35',
    fontFamily: FONT.bold,
    marginTop: 2,
    includeFontPadding: false,
  },
  popularChip: {
    marginLeft: 8,
    flexShrink: 0,
    backgroundColor: 'rgba(255,214,10,0.16)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  popularChipText: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: FONT.bold,
    color: '#FFD60A',
    includeFontPadding: false,
  },
  emptyPlans: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT.regular,
    color: '#8E8E93',
    textAlign: 'center',
    paddingVertical: 8,
    includeFontPadding: false,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  planName: {
    fontSize: 17,
    lineHeight: 22,
    fontFamily: FONT.bold,
    color: '#FFD60A',
    marginLeft: 8,
    flex: 1,
    minWidth: 0,
    includeFontPadding: false,
  },
  featuresList: {
    marginTop: 4,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  featureIcon: {
    marginTop: 1,
    marginRight: 10,
  },
  featureText: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: FONT.regular,
    color: '#D1D1D6',
    includeFontPadding: false,
  },
  payButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF6B35',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 14,
    width: '100%',
    maxWidth: 360,
    marginBottom: 12,
    minHeight: 52,
  },
  payButtonDisabled: {
    opacity: 0.6,
  },
  payButtonText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: FONT.bold,
    color: '#FFF',
    textAlign: 'center',
    includeFontPadding: false,
  },
  securedBy: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONT.regular,
    color: '#666',
    marginBottom: 16,
    includeFontPadding: false,
  },
  refreshLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  refreshText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT.medium,
    color: C.textSecondary,
    includeFontPadding: false,
  },
});
