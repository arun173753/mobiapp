import { Platform } from "react-native";

/**
 * Best-effort GPS coords for distance sorting (web + native).
 * Web uses high-accuracy browser geolocation; native uses expo-location Highest.
 */
export async function getBestUserLocation(): Promise<{ lat: number; lng: number } | null> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.geolocation) {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 },
      );
    });
  }
  try {
    const Location = require("expo-location") as typeof import("expo-location");
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });
    return { lat: loc.coords.latitude, lng: loc.coords.longitude };
  } catch {
    return null;
  }
}
