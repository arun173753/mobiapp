import { Linking, Platform } from 'react-native';
import { router } from 'expo-router';

const EXTERNAL_DOMAINS = [
  'youtube.com', 'youtu.be', 'm.youtube.com',
  'zoom.us', 'us02web.zoom.us', 'us06web.zoom.us',
  'meet.google.com', 'teams.microsoft.com', 'whereby.com',
];

function isExternalVideoLink(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return EXTERNAL_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

export function openLink(url: string, title?: string) {
  if (!url) return;
  if (url.startsWith('tel:') || url.startsWith('mailto:') || url.startsWith('sms:')) {
    Linking.openURL(url).catch(() => {});
    return;
  }

  if (Platform.OS !== 'web' && isExternalVideoLink(url)) {
    Linking.openURL(url).catch(() => {});
    return;
  }

  router.push({ pathname: '/live-link', params: { link: url, title: title || 'View Content' } });
}
