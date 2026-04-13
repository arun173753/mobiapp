/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Dynamic Expo config: inject Maps API key at prebuild (EAS) and relax Android release shrinker
 * for easier native debugging. Base config lives in app.json.
 */
const appJson = require("./app.json");

/** Baked into app at export/prebuild so Firebase / CI builds work without a local .env */
const DEFAULT_PUBLIC_API =
  "https://repair-backendarun-838751841074.asia-south1.run.app";

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
  // .env.local can override .env.production with a placeholder (e.g. api.example.com) — ignore it
  const publicApiUrl = shellOk
    ? fromShellNorm
    : process.env.NODE_ENV === "production"
      ? DEFAULT_PUBLIC_API
      : undefined;

  const mapsKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    appJson.expo?.android?.config?.googleMaps?.apiKey;

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

  return {
    expo: {
      ...appJson.expo,
      extra: {
        ...(appJson.expo.extra || {}),
        ...(publicApiUrl ? { publicApiUrl } : {}),
      },
      plugins,
      android: {
        ...appJson.expo.android,
        config: {
          ...appJson.expo.android?.config,
          googleMaps: {
            apiKey: mapsKey || "YOUR_GOOGLE_MAPS_API_KEY_HERE",
          },
        },
      },
    },
  };
};
