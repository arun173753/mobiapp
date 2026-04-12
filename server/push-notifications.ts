import fetch from 'node-fetch';
import { db } from './db';
import { profiles } from '../shared/schema';
import { eq, isNotNull, ne } from 'drizzle-orm';

// Chunk array into pieces of max length 100 for Expo
function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export async function sendNotification(title: string, body: string, data?: Record<string, any>, toTokens?: string[]) {
  if (!toTokens || toTokens.length === 0) return 0;
  
  // Filter out any invalid tokens or non-expo tokens just in case
  const validTokens = toTokens.filter(t => t && t.startsWith('ExponentPushToken'));
  if (validTokens.length === 0) return 0;

  const messages = validTokens.map(token => ({
    to: token,
    sound: 'default',
    title,
    body,
    data,
  }));

  const chunks = chunkArray(messages, 100);
  let tickets = [];

  for (let chunk of chunks) {
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
      const data = await response.json();
      tickets.push(...(data.data || []));
    } catch (error) {
      console.error('[ExpoPush] Error sending chunk:', error);
    }
  }
  return tickets.length;
}

export async function getDeviceCount(): Promise<number> {
  try {
    const result = await db.select({ id: profiles.id }).from(profiles).where(isNotNull(profiles.pushToken));
    return result.filter(r => r && (r as any).pushToken && (r as any).pushToken.startsWith('ExponentPushToken')).length;
  } catch (err) {
    console.error('[ExpoPush] getDeviceCount error:', err);
    return 0;
  }
}

export async function notifyAllUsers(msg: { title: string; body: string; data?: Record<string, any>; image?: string; bigPicture?: string }): Promise<number> {
  const users = await db.select({ pushToken: profiles.pushToken }).from(profiles).where(isNotNull(profiles.pushToken));
  const tokens = users.map(u => u.pushToken).filter(Boolean) as string[];
  return await sendNotification(msg.title, msg.body, msg.data, tokens);
}

export async function notifyUser(userId: string, msg: { title: string; body: string; data?: Record<string, any> }): Promise<void> {
  try {
    const result = await db.select({ pushToken: profiles.pushToken }).from(profiles).where(eq(profiles.id, userId));
    if (result.length > 0 && result[0].pushToken) {
      await sendNotification(msg.title, msg.body, msg.data, [result[0].pushToken]);
    }
  } catch (err) {
    console.error('[ExpoPush] notifyUser error:', err);
  }
}

export async function notifyNewPost(postText: string, userName: string, userId: string): Promise<void> {
  const users = await db.select({ pushToken: profiles.pushToken }).from(profiles).where(ne(profiles.id, userId));
  const tokens = users.map(u => u.pushToken).filter(Boolean) as string[];
  await sendNotification('New Post', `${userName}: ${postText.slice(0, 80)}`, { type: 'new_post', userId }, tokens);
}

export async function notifyLiveChat(senderName: string, message: string, senderId: string): Promise<void> {
  const users = await db.select({ pushToken: profiles.pushToken }).from(profiles).where(ne(profiles.id, senderId));
  const tokens = users.map(u => u.pushToken).filter(Boolean) as string[];
  await sendNotification('Live Chat', `${senderName}: ${message.slice(0, 80)}`, { type: 'live_chat', senderId }, tokens);
}

export async function notifyUsersByRole(
  role: string,
  msg: { title: string; body: string; data?: Record<string, any> },
  externalUserIds?: string[]
): Promise<number> {
  let tokens: string[] = [];
  
  if (externalUserIds && externalUserIds.length > 0) {
    // If specific externalUserIds are provided
    for (const uid of externalUserIds) {
      const user = await db.select({ pushToken: profiles.pushToken }).from(profiles).where(eq(profiles.id, uid));
      if (user.length > 0 && user[0].pushToken) tokens.push(user[0].pushToken);
    }
  } else if (role === 'all') {
    const users = await db.select({ pushToken: profiles.pushToken }).from(profiles).where(isNotNull(profiles.pushToken));
    tokens = users.map(u => u.pushToken).filter(Boolean) as string[];
  } else {
    // Specific role
    const users = await db.select({ pushToken: profiles.pushToken }).from(profiles).where(eq(profiles.role, role));
    tokens = users.map(u => u.pushToken).filter(Boolean) as string[];
  }
  
  if (tokens.length === 0) return 0;
  return await sendNotification(msg.title, msg.body, msg.data, tokens);
}
