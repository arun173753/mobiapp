/**
 * Shared helpers for turning API profile data into map markers.
 *
 * Why these exist:
 * - `role` comes back from the backend in mixed casing (e.g. "Technician", "SUPPLIER")
 *   and occasionally with trailing whitespace. Using it directly in `Set.has(...)`
 *   silently drops profiles on native, while web accidentally tolerated it. Both
 *   platforms MUST filter via `normalizeRole(...)`.
 * - `latitude` / `longitude` are declared as strings in `UserProfile` and the server
 *   really does send them as strings. `react-native-maps` on Android silently ignores
 *   any `<Marker coordinate={{ latitude, longitude }} />` whose fields aren't real
 *   numbers — so we must coerce through `Number(...)` AND validate with `isNaN`
 *   before rendering.
 */

/** Roles shown on the directory full-screen map (matches legend in screenshots). */
export const DIRECTORY_MAP_ROLES: ReadonlySet<string> = new Set([
  'technician',
  'teacher',
  'supplier',
  'shopkeeper',
]);

/** Roles allowed on extended maps (nearby, home feed, etc.). */
export const MAP_ROLES: ReadonlySet<string> = new Set([
  'technician',
  'teacher',
  'supplier',
  'shopkeeper',
  'doctor',
  'lawyer',
  'software_developer',
  'digital_marketer',
  'driver',
  'delivery_partner',
  'freelancer',
  'service_provider',
  'labour',
  'cleaner',
  'mechanic',
  'electrician',
  'plumber',
  'carpenter',
  'painter',
  'welder',
]);

/**
 * Normalize a role / type value so case / whitespace differences between server
 * and client don't cause silent drops. Safe on null / undefined / non-string.
 */
export function normalizeRole(role: unknown): string {
  return String(role ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Coerce a lat/lng string-or-number into a finite JS number.
 * Returns `null` if the input is empty / null / not a finite number.
 * (Use this instead of `parseFloat` — `parseFloat("abc123")` returns NaN,
 * while `parseFloat("123abc")` returns 123, which is a nasty source of bad pins.)
 */
export function parseCoord(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Safely coerce a profile into a `{ lat, lng, role }` triple usable by the map.
 * Returns `null` when the profile shouldn't be rendered as a marker.
 *
 * When `options.debug` is true, each rejection / acceptance is logged with the
 * profile id so we can trace marker loss in logcat.
 */
export function toMapMarkerInput(
  p: { id: string; latitude?: unknown; longitude?: unknown; role?: unknown },
  options: { allowedRoles?: ReadonlySet<string>; debug?: boolean } = {},
): { id: string; lat: number; lng: number; role: string } | null {
  const role = normalizeRole(p.role);
  const lat = parseCoord(p.latitude);
  const lng = parseCoord(p.longitude);
  const allowed = options.allowedRoles ?? MAP_ROLES;

  if (options.debug) {
    // Small, searchable log line per profile — matches the shape the user asked for.
    // eslint-disable-next-line no-console
    console.log("[map-debug] profile:", {
      id: p.id,
      role: p.role,
      normalized: role,
      lat: p.latitude,
      lng: p.longitude,
    });
  }

  if (!allowed.has(role)) return null;
  if (lat === null || lng === null) return null;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { id: p.id, lat, lng, role };
}
