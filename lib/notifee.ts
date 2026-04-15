import { Platform } from "react-native";
import Constants from "expo-constants";

function isExpoGo(): boolean {
  const appOwnership = (Constants as any)?.appOwnership;
  return appOwnership === "expo";
}

async function getNotifee(): Promise<any | null> {
  if (Platform.OS !== "android") return null;
  if ((Constants as any)?.isDevice === false) return null;
  if (isExpoGo()) return null; // Notifee requires native build.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@notifee/react-native");
  } catch (e) {
    console.warn("[Notifee] Not available:", e);
    return null;
  }
}

export const HIGH_PRIORITY_CHANNEL_ID = "high-priority";

export async function ensureHighPriorityChannel(): Promise<string | null> {
  const notifee = await getNotifee();
  if (!notifee) return null;

  try {
    const { AndroidImportance } = notifee;
    // Always (re)create; Android will no-op if unchanged.
    await notifee.createChannel({
      id: HIGH_PRIORITY_CHANNEL_ID,
      name: "High Priority Notifications",
      importance: AndroidImportance.HIGH,
      sound: "default",
      vibration: true,
      vibrationPattern: [300, 500],
      lights: true,
    });
    return HIGH_PRIORITY_CHANNEL_ID;
  } catch (e) {
    console.warn("[Notifee] createChannel failed:", e);
    return null;
  }
}

