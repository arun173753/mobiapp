/**
 * Ensures EXPO_PUBLIC_DOMAIN is set for `expo export` (canonical Firebase Hosting URL).
 * API base stays on EXPO_PUBLIC_API_URL — do not use the Cloud Run hostname as the web app domain.
 */
const FIREBASE_HOSTING_WEB_APP = "https://arunmobi-app.web.app";

if (!process.env.EXPO_PUBLIC_DOMAIN && !process.env.EXPO_PUBLIC_API_URL) {
  console.error(
    "Set EXPO_PUBLIC_DOMAIN (e.g. " +
      FIREBASE_HOSTING_WEB_APP +
      ") and EXPO_PUBLIC_API_URL (Cloud Run) before export (see .env.example).",
  );
  process.exit(1);
}
if (!process.env.EXPO_PUBLIC_DOMAIN) {
  process.env.EXPO_PUBLIC_DOMAIN = FIREBASE_HOSTING_WEB_APP;
}

const { execSync } = require("child_process");
execSync("npx expo export -p web", { stdio: "inherit", env: process.env });
