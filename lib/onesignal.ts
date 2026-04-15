import { Platform } from "react-native";
import Constants from "expo-constants";

type OneSignalSdk = (typeof import("react-native-onesignal"))["OneSignal"];

// Expo Go cannot load custom native modules like react-native-onesignal.
export function isExpoGo(): boolean {
  const appOwnership = (Constants as any)?.appOwnership;
  // 'expo' indicates Expo Go. (Standalone/dev-client are usually 'standalone' / 'guest'.)
  return appOwnership === "expo";
}

function getOneSignalAppId(): string {
  const extra = Constants.expoConfig?.extra as { oneSignalAppId?: string } | undefined;
  return (
    process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ||
    extra?.oneSignalAppId ||
    process.env.ONESIGNAL_APP_ID ||
    ""
  ).trim();
}

let _os: OneSignalSdk | null = null;
async function getOneSignal(): Promise<OneSignalSdk | null> {
  if (Platform.OS === "web") return null;
  // Push is only meaningful on physical devices.
  if ((Constants as any)?.isDevice === false) return null;
  if (isExpoGo()) {
    // Prevent runtime crash in Expo Go.
    console.warn("[OneSignal] Disabled in Expo Go (native module not available). Use a dev build to test push.");
    return null;
  }
  if (_os) return _os;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-onesignal");
    // SDK is a named export: `import { OneSignal } from "react-native-onesignal"`
    _os = (mod?.OneSignal ?? mod?.default?.OneSignal ?? null) as OneSignalSdk | null;
    return _os;
  } catch (e) {
    console.warn("[OneSignal] SDK not available:", e);
    return null;
  }
}

let initialized = false;

export async function initOneSignal(): Promise<void> {
  if (Platform.OS === "web") return;
  if (initialized) return;

  const OneSignal = await getOneSignal();
  if (!OneSignal) return;

  const appId = getOneSignalAppId();
  if (!appId) {
    console.warn("[OneSignal] Missing EXPO_PUBLIC_ONESIGNAL_APP_ID (set in .env or EAS secrets)");
    return;
  }
  console.log("[OneSignal] Initializing with App ID:", `${appId.slice(0, 8)}…${appId.slice(-4)} (len ${appId.length})`);

  try {
    OneSignal.Debug.setLogLevel?.(6);
    OneSignal.initialize(appId);

    // Foreground notifications: show normally (don’t suppress).
    OneSignal.Notifications.addEventListener("foregroundWillDisplay", (event: any) => {
      try {
        const n = event?.getNotification?.();
        console.log("[OneSignal] foregroundWillDisplay:", n?.notificationId);
        n?.display?.();
      } catch (e) {
        console.warn("[OneSignal] foreground display:", e);
      }
    });
    OneSignal.Notifications.addEventListener("click", (event: any) => {
      try {
        const addl = event?.notification?.additionalData || {};
        const openUrl = String(addl.openUrl || addl.link || "").trim();
        const path = String(addl.path || "").trim();
        console.log("[OneSignal] notification click:", event?.notification?.notificationId, { path, openUrl });
        // Defer so native navigation runs outside the OneSignal callback stack.
        setTimeout(() => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { Linking } = require("react-native");
            if (openUrl.startsWith("https://") || openUrl.startsWith("http://")) {
              void Linking.openURL(openUrl);
              return;
            }
            if (path) {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { router } = require("expo-router");
              router.push(path as any);
            }
          } catch (e) {
            console.warn("[OneSignal] click navigate:", e);
          }
        }, 0);
      } catch {}
    });

    // Log subscription id changes
    OneSignal.User.pushSubscription.addEventListener("change", (state: any) => {
      try {
        console.log("[OneSignal] subscription changed:", {
          optedIn: state?.current?.optedIn,
          id: state?.current?.id,
          token: state?.current?.token ? "present" : "missing",
        });
      } catch {}
    });

    initialized = true;
    console.log("[OneSignal] initialized; push subscription listeners active");
    void getOneSignalSubscriptionId().catch(() => {});
  } catch (e) {
    console.warn("[OneSignal] init failed:", e);
  }
}

export async function requestOneSignalPermission(): Promise<boolean> {
  const OneSignal = await getOneSignal();
  if (!OneSignal) return false;
  try {
    const granted = await OneSignal.Notifications.requestPermission(true);
    console.log("[OneSignal] permission:", granted ? "granted" : "denied");
    return !!granted;
  } catch (e) {
    console.warn("[OneSignal] permission request failed:", e);
    return false;
  }
}

export async function loginOneSignal(externalUserId: string): Promise<void> {
  const OneSignal = await getOneSignal();
  if (!OneSignal) return;
  try {
    OneSignal.login(externalUserId);
    console.log("[OneSignal] login external_id:", externalUserId.slice(0, 8) + "...");
  } catch (e) {
    console.warn("[OneSignal] login failed:", e);
  }
}

export async function logoutOneSignal(): Promise<void> {
  const OneSignal = await getOneSignal();
  if (!OneSignal) return;
  try {
    OneSignal.logout();
    console.log("[OneSignal] logout");
  } catch (e) {
    console.warn("[OneSignal] logout failed:", e);
  }
}

export async function getOneSignalSubscriptionId(): Promise<string | null> {
  const OneSignal = await getOneSignal();
  if (!OneSignal) return null;
  try {
    const getAsync = OneSignal.User.pushSubscription.getIdAsync?.bind(OneSignal.User.pushSubscription);
    const id = getAsync ? await getAsync() : OneSignal.User.pushSubscription.getPushSubscriptionId?.() || null;
    if (id) console.log("[OneSignal] player / subscription id:", String(id));
    return id ? String(id) : null;
  } catch (e) {
    console.warn("[OneSignal] get subscription id failed:", e);
    return null;
  }
}

/**
 * When false, the app should not schedule duplicate local (Expo) chat banners — OneSignal delivers pushes
 * on dev builds / APK. Still true for web, Expo Go, simulators, or if the native module failed to load.
 */
export async function shouldScheduleLocalMessageBanner(): Promise<boolean> {
  if (Platform.OS === "web") return true;
  if (isExpoGo()) return true;
  if ((Constants as any)?.isDevice === false) return true;
  const OneSignal = await getOneSignal();
  return !OneSignal;
}

