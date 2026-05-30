import Constants from 'expo-constants';

const PLACEHOLDER = 'YOUR_GOOGLE_MAPS_API_KEY_HERE';

/** Android Maps SDK key baked at build time (see app.config.js `extra.googleMapsAndroidApiKey`). */
export function getAndroidMapsSdkKey(): string {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const fromExtra = String(extra?.googleMapsAndroidApiKey ?? '').trim();
  const fromAndroid = String(
    (Constants.expoConfig?.android?.config as { googleMaps?: { apiKey?: string } } | undefined)
      ?.googleMaps?.apiKey ?? '',
  ).trim();
  const key = fromExtra || fromAndroid;
  if (!key || key.includes(PLACEHOLDER)) return '';
  return key;
}

export function isAndroidMapsKeyMissing(): boolean {
  return !getAndroidMapsSdkKey();
}
