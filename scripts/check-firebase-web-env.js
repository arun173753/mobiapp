/**
 * Validates EXPO_PUBLIC_FIREBASE_* before web export / hosting deploy.
 * Does not print secret values — only lengths and obvious mistakes.
 *
 * Usage: node scripts/check-firebase-web-env.js [--strict]
 *   --strict  exit 1 if any Firebase web var is missing (use when vars are only in .env files, not CI injection)
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");

function loadEnvFile(rel) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) return;
  const text = fs.readFileSync(fp, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = val;
  }
}

loadEnvFile(".env.production");
loadEnvFile(".env");
loadEnvFile(".env.local");

const FB_KEYS = [
  "EXPO_PUBLIC_FIREBASE_API_KEY",
  "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "EXPO_PUBLIC_FIREBASE_APP_ID",
  "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
];

function mask(s) {
  if (!s || s.length < 12) return s ? "(set)" : "(empty)";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

let exitCode = 0;
const values = Object.fromEntries(FB_KEYS.map((k) => [k, (process.env[k] || "").trim()]));
const setCount = FB_KEYS.filter((k) => values[k]).length;

if (setCount === 0) {
  console.warn(
    "[check-firebase-web-env] No EXPO_PUBLIC_FIREBASE_* in .env / .env.production / .env.local.\n" +
      "  If you inject them only in CI/EAS, that is fine. Otherwise add the Web app block from Firebase Console.",
  );
  if (strict) {
    console.error("[check-firebase-web-env] --strict: missing Firebase web env.");
    exitCode = 1;
  }
  process.exit(exitCode);
}

if (setCount < FB_KEYS.length) {
  console.error("[check-firebase-web-env] Incomplete Firebase web config (mix of set/empty):");
  for (const k of FB_KEYS) {
    console.error(`  ${k}: ${values[k] ? "set " + mask(values[k]) : "MISSING"}`);
  }
  console.error("  Copy all six fields from Firebase Console → Project settings → Your apps (Web).");
  process.exit(1);
}

const apiKey = values.EXPO_PUBLIC_FIREBASE_API_KEY;
const mapsKey = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "").trim();
if (mapsKey && apiKey === mapsKey) {
  console.error(
    "[check-firebase-web-env] EXPO_PUBLIC_FIREBASE_API_KEY equals your Maps web key.\n" +
      "  They must be different: use the Web API key from the Firebase console, not Google Maps.",
  );
  process.exit(1);
}

const projectId = values.EXPO_PUBLIC_FIREBASE_PROJECT_ID.toLowerCase();
if (projectId !== "arunmobi-app") {
  console.error(
    '[check-firebase-web-env] EXPO_PUBLIC_FIREBASE_PROJECT_ID must be "arunmobi-app" for this app (Firebase Hosting project). Got:',
    values.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "(empty)",
  );
  process.exit(1);
}

const LEGACY = ["mobile-repair-app", "276b6"].join("-");
for (const k of FB_KEYS) {
  const v = (values[k] || "").toLowerCase();
  if (v.includes(LEGACY)) {
    console.error(`[check-firebase-web-env] ${k} references legacy Firebase project "${LEGACY}". Use arunmobi-app Web app values only.`);
    process.exit(1);
  }
}

const bucket = (values.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "").toLowerCase();
if (bucket && !bucket.includes(projectId)) {
  console.error(
    "[check-firebase-web-env] EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET must belong to project arunmobi-app (e.g. arunmobi-app.firebasestorage.app). Got:",
    values.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  );
  process.exit(1);
}

const apiKeyLower = (values.EXPO_PUBLIC_FIREBASE_API_KEY || "").toLowerCase();
const appIdLower = (values.EXPO_PUBLIC_FIREBASE_APP_ID || "").toLowerCase();
const senderLower = (values.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "").toLowerCase();
const placeholderHints = ["your_api", "your_app", "paste_here", "replace_me", "changeme", "<from firebase", "replace"];
const hasPlaceholder = (s) => placeholderHints.some((h) => s.includes(h));
if (hasPlaceholder(apiKeyLower) || hasPlaceholder(appIdLower) || hasPlaceholder(senderLower)) {
  console.error(
    "[check-firebase-web-env] Replace placeholder EXPO_PUBLIC_FIREBASE_* values with real Web app fields from Firebase Console (project arunmobi-app).",
  );
  process.exit(1);
}

const authDomain = values.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN.toLowerCase();
const m = authDomain.match(/^([a-z0-9-]+)\.firebaseapp\.com$/);
if (m && m[1] !== projectId) {
  console.error(
    `[check-firebase-web-env] authDomain subdomain "${m[1]}" does not match projectId "${projectId}".\n` +
      "  Typical fix: EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=<projectId>.firebaseapp.com",
  );
  process.exit(1);
}

console.log("[check-firebase-web-env] OK — Firebase web env present (apiKey " + mask(apiKey) + ", projectId " + projectId + ")");
console.log(
  "  GCP: enable Identity Toolkit API; API key HTTP referrers must include:\n" +
    "    https://arunmobi-app.web.app/*  and  https://arunmobi-app.firebaseapp.com/*",
);
process.exit(0);
