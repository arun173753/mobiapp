import fetch from 'node-fetch';
import { db } from './db';
import { profiles } from '../shared/schema';
import { eq, isNotNull } from 'drizzle-orm';

/** Public default art for rich push (Hosting: /notification-default.png). Override with DEFAULT_PUSH_NOTIFICATION_IMAGE. */
export function getDefaultPushNotificationImageUrl(): string {
  const fromEnv = (process.env.DEFAULT_PUSH_NOTIFICATION_IMAGE || '').trim();
  if (fromEnv.startsWith('https://')) return fromEnv;
  const domain = (process.env.EXPO_PUBLIC_DOMAIN || process.env.APP_DOMAIN || '').trim().replace(/\/+$/, '');
  if (domain.startsWith('https://')) return `${domain}/notification-default.png`;
  return 'https://arunmobi-app.web.app/notification-default.png';
}

/**
 * Returns a safe HTTPS URL for OneSignal big_picture / attachments.
 * Only JPG/PNG URLs accepted; otherwise returns default (never empty).
 */
export function resolveNotificationAttachmentUrl(raw?: string | null): string {
  const fallback = getDefaultPushNotificationImageUrl();
  const s = String(raw ?? '').trim();
  if (!s) return fallback;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return fallback;
    const path = (u.pathname || '').toLowerCase();
    const ok = /\.(jpe?g|png)$/i.test(path);
    if (!ok) return fallback;
    return u.toString();
  } catch {
    return fallback;
  }
}

function applyOneSignalRichMedia(payload: Record<string, any>, imageHttpsUrl: string) {
  const u = imageHttpsUrl;
  payload.big_picture = u;
  payload.large_icon = u;
  payload.chrome_web_image = u;
  payload.ios_attachments = { mobi: u };
}

/** Full HTTPS URL to open when user taps (Android / iOS / web). */
function resolveNotificationLaunchUrl(data?: Record<string, any>): string | undefined {
  if (!data) return undefined;
  const direct = String(data.openUrl || data.link || "").trim();
  if (direct.startsWith("https://")) return direct;
  const path = String(data.path || "").trim();
  if (!path) return undefined;
  const base = (process.env.EXPO_PUBLIC_DOMAIN || process.env.APP_DOMAIN || "").trim().replace(/\/+$/, "");
  if (!base.startsWith("http")) return undefined;
  const p = path.startsWith("/") ? path : `/${path}`;
  try {
    return new URL(p, base.endsWith("/") ? base : `${base}/`).toString();
  } catch {
    return undefined;
  }
}

function applyNotificationDeepLink(payload: Record<string, any>, data?: Record<string, any>) {
  const launch = resolveNotificationLaunchUrl(data);
  if (!launch) return;
  payload.url = launch;
  payload.web_url = launch;
}

/** OneSignal `data` values should be strings for reliable Android delivery. */
export function stringifyNotificationData(data?: Record<string, any>): Record<string, string> | undefined {
  if (!data) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    const key = String(k);
    if (typeof v === 'string') out[key] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[key] = String(v);
    else
      try {
        out[key] = JSON.stringify(v);
      } catch {
        out[key] = String(v);
      }
  }
  return Object.keys(out).length ? out : undefined;
}

export type SendPushOptions = { imageUrl?: string | null };

export type SendNotificationResult = { recipients: number; id?: string };

type OneSignalResponse = {
  id?: string;
  recipients?: number;
  errors?: any;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function requireEnv(name: 'ONESIGNAL_APP_ID' | 'ONESIGNAL_REST_API_KEY'): string {
  const v = (process.env[name] || '').trim();
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

export function isOneSignalConfigured(): boolean {
  return !!(process.env.ONESIGNAL_APP_ID || '').trim() && !!(process.env.ONESIGNAL_REST_API_KEY || '').trim();
}

async function createOneSignalNotification(payload: Record<string, any>): Promise<OneSignalResponse> {
  // Retry transient failures (429/5xx/network).
  const maxAttempts = 3;
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${requireEnv('ONESIGNAL_REST_API_KEY')}`,
        },
        body: JSON.stringify(payload),
      });

      const text = await response.text().catch(() => '');
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!response.ok) {
        const err = new Error(
          `OneSignal API error: ${response.status} ${response.statusText} - ${text || '(empty body)'}`
        ) as Error & { status?: number; body?: any };
        err.status = response.status;
        err.body = json ?? text;

        // Retry on rate-limit / transient server errors
        if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
          lastErr = err;
          if (attempt < maxAttempts) {
            await sleep(250 * attempt * attempt);
            continue;
          }
        }
        throw err;
      }

      const out = (json ?? {}) as OneSignalResponse;
      // OneSignal may return 200 with an `errors` field for invalid targeting, etc.
      if ((out as any)?.errors) {
        const err = new Error(`OneSignal API returned errors: ${JSON.stringify((out as any).errors)}`) as Error & { body?: any };
        err.body = out;
        throw err;
      }
      const nid = (out as any)?.id;
      if (nid) {
        console.log('[OneSignal] notification created id=%s recipients=%s', String(nid), String((out as any)?.recipients ?? ''));
      }
      return out;
    } catch (e: any) {
      lastErr = e;
      const status = e?.status as number | undefined;
      const transient = status === 429 || (typeof status === 'number' && status >= 500) || !status;
      if (transient && attempt < maxAttempts) {
        await sleep(250 * attempt * attempt);
        continue;
      }
      throw e;
    }
  }

  throw lastErr ?? new Error('OneSignal notification failed');
}

export async function getOneSignalSubscriberCount(): Promise<number> {
  const appId = requireEnv('ONESIGNAL_APP_ID');
  const response = await fetch(`https://onesignal.com/api/v1/apps/${encodeURIComponent(appId)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${requireEnv('ONESIGNAL_REST_API_KEY')}`,
    },
  });

  const text = await response.text().catch(() => '');
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const err = new Error(
      `OneSignal Apps API error: ${response.status} ${response.statusText} - ${text || '(empty body)'}`
    ) as Error & { status?: number; body?: any };
    err.status = response.status;
    err.body = json ?? text;
    throw err;
  }

  const players = Number((json as any)?.players ?? (json as any)?.users ?? 0);
  return Number.isFinite(players) ? players : 0;
}

/**
 * Sends a push notification via OneSignal.
 * - If `toExternalUserIds` is omitted/empty, broadcasts to all subscribers.
 * - Otherwise targets users by their OneSignal `external_id` (your app user id).
 */
export async function sendNotification(
  title: string,
  body: string,
  data?: Record<string, any>,
  toExternalUserIds?: string[],
  options?: SendPushOptions,
): Promise<SendNotificationResult> {
  const t = (title || '').trim();
  const b = (body || '').trim();
  if (!t || !b) return { recipients: 0 };

  const appId = requireEnv('ONESIGNAL_APP_ID');

  const payload: Record<string, any> = {
    app_id: appId,
    headings: { en: t },
    contents: { en: b },
    android_sound: process.env.ONESIGNAL_ANDROID_SOUND || 'default',
    ios_sound: process.env.ONESIGNAL_IOS_SOUND || 'default',
  };

  const dataStrings = stringifyNotificationData(data);
  if (dataStrings && Object.keys(dataStrings).length > 0) payload.data = dataStrings;

  const finalImage = resolveNotificationAttachmentUrl(options?.imageUrl ?? undefined);
  applyOneSignalRichMedia(payload, finalImage);
  applyNotificationDeepLink(payload, dataStrings as Record<string, any> | undefined);

  const ids = (toExternalUserIds || []).map((x) => String(x || '').trim()).filter(Boolean);
  if (ids.length > 0) {
    // OneSignal external_id targeting (works when devices call OneSignal.login(userId))
    payload.include_aliases = { external_id: ids };
    payload.target_channel = 'push';
  } else {
    // Broadcast: use the built-in "All" segment.
    // Segment names vary across dashboards; "All" is the safest default.
    payload.included_segments = ['All'];
    payload.target_channel = 'push';
  }

  // Android channel: OneSignal expects the Dashboard channel UUID (not the OS channel name).
  const androidChannelId = (process.env.ONESIGNAL_ANDROID_CHANNEL_ID || '').trim();
  if (androidChannelId) payload.android_channel_id = androidChannelId;

  const result = await createOneSignalNotification(payload);
  const recipients = typeof result.recipients === 'number' ? result.recipients : 0;
  const id = (result as any)?.id ? String((result as any).id) : undefined;
  return { recipients, id };
}

export async function sendNotificationToSubscriptionIds(
  title: string,
  body: string,
  data: Record<string, any> | undefined,
  subscriptionIds: string[],
  options?: SendPushOptions,
): Promise<SendNotificationResult> {
  const t = (title || '').trim();
  const b = (body || '').trim();
  const ids = (subscriptionIds || []).map((x) => String(x || '').trim()).filter(Boolean);
  if (!t || !b || ids.length === 0) return { recipients: 0 };

  const appId = requireEnv('ONESIGNAL_APP_ID');
  const payload: Record<string, any> = {
    app_id: appId,
    headings: { en: t },
    contents: { en: b },
    include_subscription_ids: ids,
    target_channel: 'push',
  };
  const dataStrings = stringifyNotificationData(data);
  if (dataStrings && Object.keys(dataStrings).length > 0) payload.data = dataStrings;

  const finalImage = resolveNotificationAttachmentUrl(options?.imageUrl ?? undefined);
  applyOneSignalRichMedia(payload, finalImage);
  applyNotificationDeepLink(payload, dataStrings as Record<string, any> | undefined);

  const result = await createOneSignalNotification(payload);
  const recipients = typeof result.recipients === 'number' ? result.recipients : 0;
  const id = (result as any)?.id ? String((result as any).id) : undefined;
  return { recipients, id };
}

export async function getDeviceCount(): Promise<number> {
  try {
    const result = await db.select({ id: profiles.id }).from(profiles).where(isNotNull(profiles.pushToken));
    // We no longer rely on Expo push tokens; treat any stored token/id as a "device/subscription" entry.
    return (result as any[]).filter((r) => r && (r as any).pushToken).length;
  } catch (err) {
    console.error('[OneSignal] getDeviceCount error:', err);
    return 0;
  }
}

export async function notifyAllUsers(msg: {
  title: string;
  body: string;
  data?: Record<string, any>;
  image?: string;
}): Promise<SendNotificationResult> {
  return await sendNotification(msg.title, msg.body, msg.data, undefined, { imageUrl: msg.image });
}

export async function notifyUser(
  userId: string,
  msg: { title: string; body: string; data?: Record<string, any>; image?: string },
): Promise<void> {
  try {
    const out = await sendNotification(msg.title, msg.body, msg.data, [userId], { imageUrl: msg.image });
    console.log(
      '[OneSignal] notifyUser ok recipient=%s recipients=%s id=%s',
      userId.slice(0, 8) + '...',
      out.recipients,
      out.id || '-',
    );
  } catch (err) {
    console.error('[OneSignal] notifyUser failed recipient=%s', userId.slice(0, 8) + '...', err);
  }
}

export async function notifyNewPost(postText: string, userName: string, userId: string): Promise<void> {
  // Broadcast (excluding sender) is not supported by segments; keep it simple and broadcast.
  await sendNotification('New Post', `${userName}: ${postText.slice(0, 80)}`, { type: 'new_post', userId }, undefined, {});
}

export async function notifyLiveChat(senderName: string, message: string, senderId: string): Promise<void> {
  // Broadcast (excluding sender) is not supported by segments; keep it simple and broadcast.
  await sendNotification('Live Chat', `${senderName}: ${message.slice(0, 80)}`, { type: 'live_chat', senderId }, undefined, {});
}

export async function notifyUsersByRole(
  role: string,
  msg: { title: string; body: string; data?: Record<string, any>; image?: string },
  externalUserIds?: string[],
): Promise<SendNotificationResult> {
  const img = { imageUrl: msg.image };
  if (externalUserIds && externalUserIds.length > 0) {
    return await sendNotification(msg.title, msg.body, msg.data, externalUserIds, img);
  }

  // No explicit targeting provided → default to broadcast
  if (role === 'all') {
    return await sendNotification(msg.title, msg.body, msg.data, undefined, img);
  }

  // For role-based sends, look up user ids and target them via external_id.
  const roleUsers = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.role, role));
  const ids = roleUsers.map((u) => u.id).filter(Boolean) as string[];
  if (ids.length === 0) return { recipients: 0 };
  return await sendNotification(msg.title, msg.body, msg.data, ids, img);
}
