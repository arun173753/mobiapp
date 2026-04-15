/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Dynamic Expo config: inject Maps API key at prebuild (EAS) and relax Android release shrinker
 * for easier native debugging. Base config lives in app.json.
 */
require("dotenv/config");
const fs = require("fs");
const path = require("path");

/** Load `.env` / `.env.local` into `process.env` for this Node process (Expo config + EAS). */
function loadProjectEnv() {
  // NOTE: Expo web export / CI typically uses NODE_ENV=production.
  // Ensure we also read `.env.production` so EXPO_PUBLIC_* are baked into the bundle.
  // IMPORTANT: order matters. We want environment-specific files (.env.production/.env.development)
  // to OVERRIDE generic `.env` values during export/build, otherwise stale keys can get baked into
  // the web bundle (causing Firebase Auth API_KEY_INVALID on Hosting).
  for (const name of [".env", ".env.local", ".env.production", ".env.development"]) {
    const p = path.join(__dirname, name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) process.env[key] = val;
    }
  }
}
loadProjectEnv();

const appJson = require("./app.json");

function normalizeApiOriginLocal(raw) {
  if (!raw || !String(raw).trim()) return "";
  let u = String(raw).trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, "");
}

function isUnusableProductionApiOrigin(url) {
  if (!url) return true;
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
    if (h === "example.com" || h.endsWith(".example.com")) return true;
    if (h.endsWith(".web.app") || h.endsWith(".firebaseapp.com")) return true;
    return false;
  } catch {
    return true;
  }
}

module.exports = () => {
  const fromShellRaw =
    process.env.EXPO_PUBLIC_API_URL ||
    process.env.EXPO_PUBLIC_DOMAIN ||
    process.env.VITE_API_URL ||
    process.env.REACT_APP_API_URL;
  const fromShellNorm = normalizeApiOriginLocal(fromShellRaw);
  const shellOk = fromShellNorm && !isUnusableProductionApiOrigin(fromShellNorm);
  // Locked backend: require EXPO_PUBLIC_API_URL (Cloud Run origin).
  const publicApiUrl = shellOk ? fromShellNorm : "";
  if (!publicApiUrl) {
    throw new Error(
      "Missing EXPO_PUBLIC_API_URL. Set it in `.env` for local dev and as an EAS secret for builds.",
    );
  }

  const PLACEHOLDER_MAPS_KEY = "YOUR_GOOGLE_MAPS_API_KEY_HERE";
  const isPlaceholderMapsKey = (k) =>
    !k ||
    String(k).trim() === "" ||
    String(k).includes(PLACEHOLDER_MAPS_KEY);

  // Web + native keys are different concepts; never fall back to app.json's placeholder Android key
  // when building the WEB maps key.
  // IMPORTANT: do not treat generic GOOGLE_MAPS_API_KEY / EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as an Android SDK key.
  // Those are commonly used for the Maps JavaScript API on web, and using them in Android/iOS native config can break maps.
  const androidMapsSdkKeyRaw =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ||
    process.env.GOOGLE_MAPS_ANDROID_API_KEY ||
    appJson.expo?.android?.config?.googleMaps?.apiKey ||
    "";

  const androidMapsSdkKey = isPlaceholderMapsKey(androidMapsSdkKeyRaw) ? "" : String(androidMapsSdkKeyRaw).trim();

  const iosMapsSdkKeyRaw =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY ||
    process.env.GOOGLE_MAPS_IOS_API_KEY ||
    appJson.expo?.ios?.config?.googleMapsApiKey ||
    "";

  const iosMapsSdkKey = isPlaceholderMapsKey(iosMapsSdkKeyRaw) ? "" : String(iosMapsSdkKeyRaw).trim();

  // Web (Maps JavaScript API): use only the browser key — do not fall back to generic keys (wrong restrictions).
  const webMapsKeyRaw = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY || "";

  const webMapsKey = isPlaceholderMapsKey(webMapsKeyRaw) ? "" : String(webMapsKeyRaw).trim();

  // Optional: Map ID for Advanced Markers / vector maps on web.
  const webMapsMapIdRaw =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_MAP_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_MAP_ID ||
    process.env.GOOGLE_MAPS_MAP_ID ||
    "";
  const webMapsMapId = String(webMapsMapIdRaw || "").trim();

  const plugins = (appJson.expo.plugins || []).map((p) => {
    if (Array.isArray(p) && p[0] === "expo-build-properties") {
      return [
        "expo-build-properties",
        {
          android: {
            ...p[1]?.android,
            newArchEnabled: true,
            enableProguardInReleaseBuilds: false,
            enableShrinkResourcesInReleaseBuilds: false,
          },
          ios: { ...p[1]?.ios, newArchEnabled: true },
        },
      ];
    }
    return p;
  });

  const googleMapsWebKey = webMapsKey;

  const oneSignalAppId =
    process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ||
    process.env.ONESIGNAL_APP_ID ||
    "";

  return {
    expo: {
      ...appJson.expo,
      extra: {
        ...(appJson.expo.extra || {}),
        publicApiUrl,
        // Firebase web env values (baked at build time for Hosting/web export)
        firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "",
        firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
        firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "",
        firebaseStorageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
        firebaseMessagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
        firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "",
        ...(googleMapsWebKey ? { googleMapsWebApiKey: googleMapsWebKey } : {}),
        ...(webMapsMapId ? { googleMapsWebMapId: webMapsMapId } : {}),
        ...(oneSignalAppId ? { oneSignalAppId: String(oneSignalAppId).trim() } : {}),
      },
      plugins,
      android: {
        ...appJson.expo.android,
        config: {
          ...appJson.expo.android?.config,
          googleMaps: {
            apiKey: androidMapsSdkKey || PLACEHOLDER_MAPS_KEY,
          },
        },
      },
      ios: {
        ...appJson.expo.ios,
        config: {
          ...appJson.expo.ios?.config,
          googleMapsApiKey: iosMapsSdkKey || PLACEHOLDER_MAPS_KEY,
        },
      },
    },
  };
};
