// Firebase configuration — set EXPO_PUBLIC_* in .env (see .env.example). No API keys in source.

let firebaseApp: any = null;
let firebaseAuth: any = null;
let firebaseInitAttempted = false;
let firebaseAvailable = false;

function getFirebaseConfig() {
  if (typeof process === "undefined") return null;
  const config = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "",
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "",
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  };
  return config;
}

export const firebaseConfig = getFirebaseConfig();

const hasRequiredConfig = !!(
  firebaseConfig?.apiKey &&
  firebaseConfig?.authDomain &&
  firebaseConfig?.projectId
);

function initializeFirebase() {
  if (firebaseInitAttempted) return firebaseAvailable;
  firebaseInitAttempted = true;

  if (!hasRequiredConfig) {
    if (typeof process !== "undefined" && (process.env as any).NODE_ENV !== "production") {
      console.warn("[Firebase] Skipping initialization — set EXPO_PUBLIC_FIREBASE_* in .env");
    }
    return false;
  }

  try {
    const { initializeApp, getApps } = require("firebase/app");
    const { getAuth } = require("firebase/auth");
    if (getApps().length === 0) {
      firebaseApp = initializeApp(firebaseConfig);
    } else {
      firebaseApp = getApps()[0];
    }
    firebaseAuth = getAuth(firebaseApp);
    firebaseAvailable = true;
  } catch (e) {
    console.warn("[Firebase] Init failed:", e);
  }
  return firebaseAvailable;
}

export function getFirebaseAuth() {
  initializeFirebase();
  return firebaseAuth;
}

export function isFirebaseAvailable() {
  initializeFirebase();
  return firebaseAvailable;
}
