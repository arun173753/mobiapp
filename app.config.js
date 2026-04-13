/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Dynamic Expo config: inject Maps API key at prebuild (EAS) and relax Android release shrinker
 * for easier native debugging. Base config lives in app.json.
 */
const appJson = require("./app.json");

module.exports = () => {
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
