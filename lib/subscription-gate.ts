import { isAdminUser } from "@/lib/types";

/**
 * Free without a paid subscription: Home, Reels, Courses, Hardware Solutions (demo models),
 * Create Post, Notifications.
 * Everything else for gated roles shows the subscription screen until the plan is active.
 */

function normPath(pathname?: string | null): string {
  let p = String(pathname || "").toLowerCase().trim();
  if (!p) return "/";
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/^\/\(tabs\)/, "") || "/";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function isRoute(p: string, base: string): boolean {
  return p === base || p.startsWith(`${base}?`) || p.startsWith(`${base}/`);
}

export function profileHasPaidSubscription(profile?: {
  subscriptionActive?: number | boolean | null;
  subscription_active?: number | boolean | null;
  subscriptionEnd?: number | string | null;
  subscription_end?: number | string | null;
  trialEnd?: number | string | null;
  trial_end?: number | string | null;
} | null): boolean {
  if (!profile) return false;
  const now = Date.now();
  const end = Number(profile.subscriptionEnd ?? profile.subscription_end ?? 0);
  const trialEnd = Number(profile.trialEnd ?? profile.trial_end ?? 0);
  const active = profile.subscriptionActive ?? profile.subscription_active;
  if ((active === true || Number(active) === 1) && end > now) return true;
  if (end > now || trialEnd > now) return true;
  return false;
}

/** Admin or paid/trial (subscription_end still in the future) can open every hardware model. */
export function canOpenFullHardwareSolutions(profile?: {
  id?: string;
  role?: string;
  phone?: string;
  email?: string;
  subscriptionActive?: number | boolean | null;
  subscription_active?: number | boolean | null;
  subscriptionEnd?: number | string | null;
  subscription_end?: number | string | null;
  trialEnd?: number | string | null;
  trial_end?: number | string | null;
} | null): boolean {
  if (isAdminUser(profile)) return true;
  return profileHasPaidSubscription(profile);
}

export function isAllowedWithoutSubscription(pathname?: string | null): boolean {
  const p = normPath(pathname);

  if (p === "/" || p === "/index" || p === "/customer-home") return true;
  if (p === "/create") return true;
  if (isRoute(p, "/notification-preferences") || isRoute(p, "/notifications")) return true;

  if (isRoute(p, "/reels") || isRoute(p, "/upload-reel") || p === "/reels-tab") return true;

  if (
    isRoute(p, "/courses") ||
    isRoute(p, "/course-detail") ||
    isRoute(p, "/course-player") ||
    isRoute(p, "/create-course") ||
    isRoute(p, "/become-teacher") ||
    isRoute(p, "/teacher-studio") ||
    isRoute(p, "/teacher-store")
  ) {
    return true;
  }

  if (
    isRoute(p, "/solutions") ||
    isRoute(p, "/solutions-brand") ||
    isRoute(p, "/solutions-viewer")
  ) {
    return true;
  }

  if (isRoute(p, "/search") || isRoute(p, "/user-profile")) return true;

  if (p === "/profile" || isRoute(p, "/edit-profile")) return true;

  if (
    isRoute(p, "/onboarding") ||
    isRoute(p, "/subscription-paywall") ||
    isRoute(p, "/support") ||
    isRoute(p, "/rider/register") ||
    isRoute(p, "/hospitality-register") ||
    p.startsWith("/api/")
  ) {
    return true;
  }

  return false;
}
