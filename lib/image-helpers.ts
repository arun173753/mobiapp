import { getApiUrl } from '@/lib/query-client';

/**
 * Returns a usable absolute image URL, or null if the value is empty/invalid.
 */
export function normalizeImageUri(
  raw: string | null | undefined,
  options?: { allowRelative?: boolean },
): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === 'null' || lower === 'undefined') return null;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/') && options?.allowRelative !== false) {
    return `${getApiUrl()}${s}`;
  }
  if (!s.includes('://') && s.length > 2) {
    return `${getApiUrl()}/${s.replace(/^\//, '')}`;
  }
  return null;
}

export function isLikelyHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/** Fields that may hold a saved profile photo across posts vs profiles. */
export type ProfilePhotoSource = {
  avatar?: string | null;
  profilePhoto?: string | null;
  profileImage?: string | null;
  userAvatar?: string | null;
};

/** First non-empty photo field (live profile photo preferred over stale post snapshot). */
export function pickProfilePhotoRaw(source?: ProfilePhotoSource | null): string {
  if (!source) return '';
  for (const key of ['avatar', 'profilePhoto', 'profileImage', 'userAvatar'] as const) {
    const s = String(source[key] || '').trim();
    if (s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined') return s;
  }
  return '';
}

/**
 * Avatar for a feed post: live author profile photo if saved, else the post's
 * stored userAvatar, else the signed-in user's photo for their own posts.
 */
export function resolvePostAvatarUri(opts: {
  postUserId?: string;
  postUserAvatar?: string | null;
  authorProfile?: ProfilePhotoSource | null;
  currentProfile?: (ProfilePhotoSource & { id?: string }) | null;
}): string | null {
  const { postUserId, postUserAvatar, authorProfile, currentProfile } = opts;
  const liveAuthor = pickProfilePhotoRaw(authorProfile);
  const liveSelf =
    currentProfile?.id && postUserId && currentProfile.id === postUserId
      ? pickProfilePhotoRaw(currentProfile)
      : '';
  const fromPost = String(postUserAvatar || '').trim();
  return normalizeImageUri(liveAuthor || liveSelf || fromPost, { allowRelative: true });
}
