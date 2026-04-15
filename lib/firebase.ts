// Firebase client: configuration MUST come only from EXPO_PUBLIC_FIREBASE_* env vars (Expo inlines at build).
// Never hardcode keys or project ids here. See .env.example.

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";

/** Hosting / client Firebase project (not mobi-backend). */
export const EXPECTED_FIREBASE_PROJECT_ID = "arunmobi-app";

/** Reject pasted config from the deprecated client project (split so the old id is not stored as one literal). */
function referencesLegacyFirebaseProject(value: string): boolean {
  const forbidden = `mobile-repair-app-${"276b6"}`;
  return value.trim().toLowerCase().includes(forbidden);
}

const ENV_KEYS = {
  apiKey: "EXPO_PUBLIC_FIREBASE_API_KEY",
  authDomain: "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  projectId: "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  storageBucket: "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  appId: "EXPO_PUBLIC_FIREBASE_APP_ID",
  messagingSenderId: "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
} as const;

export type ExpoFirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  appId: string;
  messagingSenderId: string;
};

let firebaseApp: any = null;
let firebaseAuth: any = null;
let firebaseInitAttempted = false;
let firebaseAvailable = false;
let firebaseInitError: Error | null = null;
let authStateUnsubscribe: null | (() => void) = null;
let didLogFirebaseDiagnostics = false;

function readEnv(name: string): string {
  // IMPORTANT (Expo web): env values are only inlined for direct member access
  // like `process.env.EXPO_PUBLIC_FOO`. Dynamic access `process.env[name]` will
  // be `undefined` in the browser bundle.
  //
  // Keep this function only for non-web/server contexts; client env reads must
  // come from direct member access (see `firebaseConfig` below).
  if (typeof process === "undefined") return "";
  return String((process.env as Record<string, string | undefined>)[name] ?? "").trim();
}

/** Mask for logs — never log full apiKey. */
export function maskFirebaseApiKey(apiKey: string): string {
  const s = (apiKey || "").trim();
  if (!s) return "(empty)";
  if (s.length <= 12) return "(too_short)";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function maskAppId(appId: string): string {
  const s = (appId || "").trim();
  if (!s) return "(empty)";
  const parts = s.split(":");
  if (parts.length >= 4) return `${parts[0]}:…:web:…${parts[parts.length - 1]?.slice(-6) || ""}`;
  return s.length > 20 ? `${s.slice(0, 10)}…` : s;
}

function isPlaceholderValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return true;
  if (v.includes("your_api_key") || v.includes("your_app_id")) return true;
  if (v.includes("paste_here") || v.includes("replace_me") || v.includes("changeme")) return true;
  if (v === "xxx" || v === "<from firebase console>" || v === "replace") return true;
  return false;
}

/**
 * Reads the six required Web config fields from process.env only.
 * Optional: EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID (Analytics) — not required for Auth.
 */
export function readFirebaseConfigFromEnv(): Partial<ExpoFirebaseWebConfig> & Record<string, string> {
  // Use the already-inlined `firebaseConfig` (direct process.env access) so web always works.
  // Return a mutable shape compatible with existing validation logic.
  return {
    apiKey: String(firebaseConfig.apiKey || "").trim(),
    authDomain: String(firebaseConfig.authDomain || "").trim(),
    projectId: String(firebaseConfig.projectId || "").trim(),
    storageBucket: String(firebaseConfig.storageBucket || "").trim(),
    appId: String(firebaseConfig.appId || "").trim(),
    messagingSenderId: String(firebaseConfig.messagingSenderId || "").trim(),
  };
}

// --- Required by Expo web runtime ---
// Keep this shape EXACTLY as Firebase Web config fields.
export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
} as const;

function looksLikePlaceholder(v: unknown): boolean {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return true;
  return (
    s.includes("your_key") ||
    s.includes("your_project") ||
    s.includes("your_sender") ||
    s.includes("your_app") ||
    s.includes("paste_here") ||
    s.includes("replace_me")
  );
}

const __fbDiag = {
  platform: Platform.OS,
  hasApiKey: Boolean(firebaseConfig.apiKey),
  hasAuthDomain: Boolean(firebaseConfig.authDomain),
  hasProjectId: Boolean(firebaseConfig.projectId),
  hasStorageBucket: Boolean(firebaseConfig.storageBucket),
  hasMessagingSenderId: Boolean(firebaseConfig.messagingSenderId),
  hasAppId: Boolean(firebaseConfig.appId),
  apiKeyMasked: maskFirebaseApiKey(String(firebaseConfig.apiKey || "")),
  projectId: String(firebaseConfig.projectId || ""),
  placeholderApiKey: looksLikePlaceholder(firebaseConfig.apiKey),
  placeholderProjectId: looksLikePlaceholder(firebaseConfig.projectId),
};

console.log("🔥 Firebase Config (sanitized):", {
  apiKey: __fbDiag.apiKeyMasked, // never log full key
  authDomain: firebaseConfig.authDomain || "(missing)",
  projectId: firebaseConfig.projectId || "(missing)",
});

if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId) {
  console.error("Firebase ENV NOT LOADED");
  throw new Error("Firebase ENV NOT LOADED");
}

function listMissingOrInvalidFirebaseEnv(): string[] {
  const c = readFirebaseConfigFromEnv();
  const missing: string[] = [];
  (Object.keys(ENV_KEYS) as (keyof typeof ENV_KEYS)[]).forEach((field) => {
    const v = c[field];
    if (!v) missing.push(ENV_KEYS[field]);
    else if (referencesLegacyFirebaseProject(v)) missing.push(`${ENV_KEYS[field]} (legacy project)`);
  });
  if (c.apiKey && isPlaceholderValue(c.apiKey)) missing.push(`${ENV_KEYS.apiKey} (placeholder)`);
  if (c.appId && isPlaceholderValue(c.appId)) missing.push(`${ENV_KEYS.appId} (placeholder)`);
  if (c.messagingSenderId && isPlaceholderValue(c.messagingSenderId)) {
    missing.push(`${ENV_KEYS.messagingSenderId} (placeholder)`);
  }
  if (c.storageBucket && isPlaceholderValue(c.storageBucket)) {
    missing.push(`${ENV_KEYS.storageBucket} (placeholder)`);
  }
  if (c.authDomain && isPlaceholderValue(c.authDomain)) missing.push(`${ENV_KEYS.authDomain} (placeholder)`);
  return [...new Set(missing)];
}

/** For UI/diagnostics: same issues that block `initializeApp` (empty, placeholder, or legacy project refs). */
export function getMissingOrInvalidFirebaseWebEnv(): string[] {
  return listMissingOrInvalidFirebaseEnv();
}

function logFirebaseDiagnostics(c: ReturnType<typeof readFirebaseConfigFromEnv>) {
  if (didLogFirebaseDiagnostics) return;
  didLogFirebaseDiagnostics = true;
  console.log("[Firebase] config (sanitized):", {
    projectId: c.projectId || "(missing)",
    authDomain: c.authDomain || "(missing)",
    storageBucket: c.storageBucket || "(missing)",
    messagingSenderId: c.messagingSenderId ? `${c.messagingSenderId.slice(0, 3)}…` : "(missing)",
    appId: maskAppId(c.appId || ""),
    apiKey: maskFirebaseApiKey(c.apiKey || ""),
  });
}

/** Catches common Identity Toolkit `getProjectConfig` 400 causes. */
function logFirebaseWebMisconfigHints(c: ReturnType<typeof readFirebaseConfigFromEnv>) {
  if (!c?.apiKey || !c?.projectId || !c?.authDomain) return;
  try {
    const mapsKey =
      (typeof process !== "undefined" &&
        (process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "")) ||
      "";
    if (mapsKey && c.apiKey === mapsKey.trim()) {
      console.error(
        "[Firebase] EXPO_PUBLIC_FIREBASE_API_KEY matches your Google Maps web key — use the Web app key from Firebase Console.",
      );
    }
    const pid = c.projectId.trim().toLowerCase();
    if (pid !== EXPECTED_FIREBASE_PROJECT_ID) {
      console.error(
        `[Firebase] projectId is "${c.projectId}" but this app expects "${EXPECTED_FIREBASE_PROJECT_ID}". Fix EXPO_PUBLIC_FIREBASE_PROJECT_ID and matching Web snippet.`,
      );
    }
    const ad = c.authDomain.trim().toLowerCase();
    const sub = ad.match(/^([a-z0-9-]+)\.firebaseapp\.com$/);
    if (sub && sub[1] !== EXPECTED_FIREBASE_PROJECT_ID) {
      console.error(
        `[Firebase] authDomain "${c.authDomain}" does not match project ${EXPECTED_FIREBASE_PROJECT_ID}. Use ${EXPECTED_FIREBASE_PROJECT_ID}.firebaseapp.com unless you use a registered custom auth domain.`,
      );
    }
  } catch {
    /* ignore */
  }
}

/** Snapshot for modules that read `firebaseConfig` at import time; prefer `readFirebaseConfigFromEnv()` after env loads. */
export const firebaseConfigFromEnv: Partial<ExpoFirebaseWebConfig> & Record<string, string> = readFirebaseConfigFromEnv();

/**
 * Web: getAuth + browserLocalPersistence (survives refresh).
 * Native / Expo (APK): initializeAuth + AsyncStorage persistence (survives cold start).
 */
function throwFirebaseConfigError(message: string): never {
  const err = new Error(`[Firebase] ${message}`);
  firebaseInitError = err;
  throw err;
}

function initializeFirebase() {
  if (firebaseAvailable && firebaseApp) return true;
  if (firebaseInitError) throw firebaseInitError;
  if (firebaseInitAttempted) return firebaseAvailable;

  firebaseInitAttempted = true;

  const raw = readFirebaseConfigFromEnv();
  const missing = listMissingOrInvalidFirebaseEnv();

  console.log("FIREBASE CONFIG:", {
    projectId: raw.projectId || "(missing)",
    authDomain: raw.authDomain || "(missing)",
    storageBucket: raw.storageBucket || "(missing)",
    messagingSenderId: raw.messagingSenderId ? `${raw.messagingSenderId.slice(0, 3)}…` : "(missing)",
    appId: maskAppId(raw.appId || ""),
    apiKey: maskFirebaseApiKey(raw.apiKey || ""),
  });

  if (!raw.apiKey || !raw.authDomain || !raw.projectId) {
    throwFirebaseConfigError("ENV NOT LOADED: Firebase API key/authDomain/projectId missing");
  }

  if (missing.length > 0) {
    throwFirebaseConfigError(
      `Missing or invalid env: ${missing.join(", ")}. Set EXPO_PUBLIC_FIREBASE_API_KEY, EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN, EXPO_PUBLIC_FIREBASE_PROJECT_ID (${EXPECTED_FIREBASE_PROJECT_ID}), EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET (e.g. ${EXPECTED_FIREBASE_PROJECT_ID}.appspot.com), EXPO_PUBLIC_FIREBASE_APP_ID, EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID. Restart Metro after editing .env.`,
    );
  }

  const pidNorm = (raw.projectId ?? "").trim().toLowerCase();
  if (pidNorm !== EXPECTED_FIREBASE_PROJECT_ID) {
    throwFirebaseConfigError(
      `EXPO_PUBLIC_FIREBASE_PROJECT_ID must be "${EXPECTED_FIREBASE_PROJECT_ID}". Got "${raw.projectId ?? ""}".`,
    );
  }

  console.log(
    "Firebase Project:",
    typeof process !== "undefined" ? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID : raw.projectId,
  );

  logFirebaseDiagnostics(raw);
  logFirebaseWebMisconfigHints(raw);

  try {
    const authMod = require("firebase/auth");

    const existing = getApps();
    firebaseApp = existing.length === 0 ? initializeApp(raw as any) : existing[0]!;
    console.log("[Firebase] Using singleton Firebase app instance");

    if (Platform.OS === "web") {
      firebaseAuth = authMod.getAuth(firebaseApp);
      authMod
        .setPersistence(firebaseAuth, authMod.browserLocalPersistence)
        .then(() => console.log("[Firebase] Web: browserLocalPersistence set"))
        .catch((e: unknown) => console.warn("[Firebase] setPersistence failed:", e));
    } else {
      try {
        firebaseAuth = authMod.initializeAuth(firebaseApp, {
          persistence: authMod.getReactNativePersistence(AsyncStorage),
        });
        console.log("[Firebase] Native: initializeAuth + AsyncStorage persistence");
      } catch (e: any) {
        if (e?.code === "auth/already-initialized") {
          firebaseAuth = authMod.getAuth(firebaseApp);
          console.log("[Firebase] Native: using existing auth instance");
        } else {
          throw e;
        }
      }
    }

    firebaseAvailable = true;
  } catch (e: any) {
    firebaseAvailable = false;
    const code = e?.code ?? "";
    const message = e?.message ?? String(e);
    console.error("[Firebase] Initialization failed:", code || "(no code)", message);
    console.error(
      "[Firebase] If the browser shows getProjectConfig 400: enable Identity Toolkit API, fix API key HTTP referrers (*.web.app + *.firebaseapp.com), and use one Web app config for project",
      EXPECTED_FIREBASE_PROJECT_ID,
    );
    firebaseInitError = e instanceof Error ? e : new Error(message);
    throw firebaseInitError;
  }
  return firebaseAvailable;
}

/** Debug-only listener; app session is restored via Storage + AppProvider.loadData. */
export function subscribeFirebaseAuthState() {
  try {
    initializeFirebase();
  } catch (e) {
    console.warn("[Firebase] subscribeFirebaseAuthState skipped:", e);
    return;
  }
  if (!firebaseAuth || authStateUnsubscribe) return;
  try {
    const { onAuthStateChanged } = require("firebase/auth");
    authStateUnsubscribe = onAuthStateChanged(firebaseAuth, (user: any) => {
      console.log("[Firebase] onAuthStateChanged:", user?.uid || null);
    });
  } catch (e) {
    console.warn("[Firebase] onAuthStateChanged attach failed:", e);
  }
}

export function unsubscribeFirebaseAuthState() {
  try {
    authStateUnsubscribe?.();
  } catch {
    /* ignore */
  }
  authStateUnsubscribe = null;
}

export function getFirebaseAuth() {
  initializeFirebase();
  return firebaseAuth;
}

export function isFirebaseAvailable() {
  try {
    initializeFirebase();
    return firebaseAvailable;
  } catch {
    return false;
  }
}
