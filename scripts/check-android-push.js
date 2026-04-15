/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

function fail(msg) {
  console.error(`\n[check-android-push] ERROR: ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[check-android-push] OK: ${msg}`);
}

function main() {
  const root = path.resolve(__dirname, "..");
  const gs = path.join(root, "google-services.json");
  if (!fs.existsSync(gs)) {
    fail(
      "Missing google-services.json at repo root. Download it from Firebase Console (Project: arunmobi-app) for package com.mobi.app and place it at ./google-services.json",
    );
  }
  ok("google-services.json present");

  const oneSignalAppId = (process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID || process.env.ONESIGNAL_APP_ID || "").trim();
  if (!oneSignalAppId || oneSignalAppId.length < 10) {
    fail("Missing EXPO_PUBLIC_ONESIGNAL_APP_ID (OneSignal App ID). Set it in EAS secrets or your shell env.");
  }
  ok("OneSignal App ID present");

  // Google Maps key is optional for push, but the user asked Maps to work in APK.
  const mapsKey = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY || "").trim();
  if (!mapsKey || mapsKey.includes("YOUR_GOOGLE_MAPS_API_KEY_HERE")) {
    console.warn("[check-android-push] WARN: Missing EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (Maps may be blank in APK).");
  } else {
    ok("Google Maps key present");
  }

  ok("Preflight checks complete");
}

main();

