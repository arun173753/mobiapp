import { Platform } from 'react-native';
import { getApiUrl } from './query-client';
import { getOneSignalSubscriptionId, initOneSignal, loginOneSignal, logoutOneSignal as osLogout, requestOneSignalPermission } from './onesignal';

let Notifications: any = null;
const getNotifications = () => {
  if (Platform.OS === 'web') return null;
  if (!Notifications) {
    try {
      Notifications = require('expo-notifications');
      // Ensure notifications show up even when the app is foregrounded
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });
    } catch (e) {
      console.warn('Failed to load expo-notifications:', e);
    }
  }
  return Notifications;
};

// Lazy-load expo-av Audio to avoid crashes on devices where it fails to initialize
let AudioLib: any = null;
const getAudio = (): any | null => {
  if (Platform.OS === 'web') return null;
  if (!AudioLib) {
    try {
      const av = require('expo-av');
      AudioLib = av?.Audio ?? null;
    } catch (e) {
      console.warn('[Notification] expo-av load failed:', e);
    }
  }
  return AudioLib;
};

let messageSoundObj: any = null;
let orderSoundObj: any = null;

const MESSAGE_SOUND_URI = 'https://cdn.pixabay.com/audio/2022/12/12/audio_e8c0ecad29.mp3';
const ORDER_SOUND_URI = 'https://cdn.pixabay.com/audio/2022/11/17/audio_f3b9130043.mp3';

async function ensureAudioMode() {
  try {
    const Audio = getAudio();
    if (!Audio?.setAudioModeAsync) return;
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
  } catch {}
}

export async function playMessageSound() {
  try {
    const Audio = getAudio();
    if (!Audio?.Sound?.createAsync) return;
    await ensureAudioMode();
    if (messageSoundObj) {
      await messageSoundObj.replayAsync().catch(() => {});
    } else {
      const { sound } = await Audio.Sound.createAsync(
        { uri: MESSAGE_SOUND_URI },
        { shouldPlay: true, volume: 0.8 }
      );
      messageSoundObj = sound;
    }
  } catch (e) {
    console.warn('[Notification] Message sound error:', e);
  }
}

export async function playOrderSound() {
  try {
    const Audio = getAudio();
    if (!Audio?.Sound?.createAsync) return;
    await ensureAudioMode();
    if (orderSoundObj) {
      await orderSoundObj.replayAsync().catch(() => {});
    } else {
      const { sound } = await Audio.Sound.createAsync(
        { uri: ORDER_SOUND_URI },
        { shouldPlay: true, volume: 1.0 }
      );
      orderSoundObj = sound;
    }
  } catch (e) {
    console.warn('[Notification] Order sound error:', e);
  }
}

export async function showMessageNotification(senderName: string, messageText: string) {
  const Notifs = getNotifications();
  if (!Notifs) return;
  try {
    await Notifs.scheduleNotificationAsync({
      content: {
        title: senderName,
        body: messageText || 'Sent an image',
        sound: true,
      },
      trigger: null,
    });
  } catch (e) {
    console.warn('[Notification] Show message notification error:', e);
  }
}

export async function showOrderNotification(buyerName: string, productTitle: string) {
  const Notifs = getNotifications();
  if (!Notifs) return;
  try {
    await Notifs.scheduleNotificationAsync({
      content: {
        title: 'New Order Received!',
        body: `${buyerName} ordered "${productTitle}"`,
        sound: true,
      },
      trigger: null,
    });
  } catch (e) {
    console.warn('[Notification] Show order notification error:', e);
  }
}

export async function requestNotificationPermission() {
  const Notifs = getNotifications();
  if (!Notifs) return;
  try {
    const { status } = await Notifs.getPermissionsAsync();
    if (status !== 'granted') {
      await Notifs.requestPermissionsAsync();
    }
  } catch {}
}

import Constants from 'expo-constants';

let pushSubscriptionListenerAttached = false;
let pushSubscriptionUserId: string | null = null;

async function registerWithBackend(userId: string, sessionToken: string | null, pushToken: string): Promise<void> {
  try {
    const baseUrl = getApiUrl();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['x-session-token'] = sessionToken;
    const res = await fetch(`${baseUrl}/api/onesignal/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId, playerId: pushToken }),
    });
    const data = await res.json().catch(() => ({})) as any;
    console.log('[Push] Backend registration result:', data?.success ? 'ok' : 'failed', data?.message ?? '');
  } catch (e) {
    console.warn('[Push] Backend register failed:', e);
  }
}

function ensurePushSubscriptionSyncListener(userId: string) {
  if (Platform.OS === 'web') return;
  pushSubscriptionUserId = userId;
  if (pushSubscriptionListenerAttached) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OneSignal } = require('react-native-onesignal');
    if (!OneSignal?.User?.pushSubscription?.addEventListener) return;
    const handler = async (state: any) => {
      const uid = pushSubscriptionUserId;
      const sid = state?.current?.id ? String(state.current.id) : '';
      if (!uid || !sid) return;
      let sessionToken: string | null = null;
      try {
        const Storage = await import('./storage');
        sessionToken = await Storage.getSessionToken();
      } catch {
        /* ignore */
      }
      await registerWithBackend(uid, sessionToken, sid);
      console.log('[OneSignal] subscription change synced to backend');
    };
    OneSignal.User.pushSubscription.addEventListener('change', handler);
    pushSubscriptionListenerAttached = true;
    console.log('[OneSignal] pushSubscription listener attached');
  } catch (e) {
    console.warn('[OneSignal] attach subscription listener:', e);
  }
}

export function clearPushRegistrationContext() {
  pushSubscriptionUserId = null;
}

export async function registerPushToken(userId: string, sessionToken?: string | null): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    // OneSignal: initialize early, request permission, login external user id.
    await initOneSignal();
    await requestOneSignalPermission();
    await loginOneSignal(userId);
    ensurePushSubscriptionSyncListener(userId);

    let oneSignalId: string | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      oneSignalId = await getOneSignalSubscriptionId();
      if (oneSignalId) break;
      await new Promise((r) => setTimeout(r, 400));
    }

    if (oneSignalId) {
      let token: string | null = sessionToken ?? null;
      if (!token) {
        try {
          const Storage = await import('./storage');
          token = await Storage.getSessionToken();
        } catch {}
      }
      await registerWithBackend(userId, token, oneSignalId);
      console.log('[OneSignal] Registration complete for user:', userId.slice(0, 8) + '...', 'playerId ok');
      return;
    }

    const Notifs = getNotifications();
    if (!Notifs) return;

    let token: string | null = sessionToken ?? null;
    if (!token) {
      try {
        const Storage = await import('./storage');
        token = await Storage.getSessionToken();
      } catch {}
    }

    const { status: existingStatus } = await Notifs.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifs.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('[Push] Permission not granted');
      return;
    }

    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? 'c6213d87-17ca-4fc7-87d6-306728cc54e3';
    const tokenData = await Notifs.getExpoPushTokenAsync({ projectId });
    const pushToken = tokenData.data;

    // Register with backend to store the token
    await registerWithBackend(userId, token, pushToken);
    console.log('[Push] Registration complete for user:', userId.slice(0, 8) + '...');
  } catch (e) {
    console.warn('[Push] Registration error:', e);
  }
}

export function logoutOneSignal(): void {
  clearPushRegistrationContext();
  osLogout().catch(() => {});
}

export function cleanupSounds() {
  messageSoundObj?.unloadAsync().catch(() => {});
  orderSoundObj?.unloadAsync().catch(() => {});
  messageSoundObj = null;
  orderSoundObj = null;
}
