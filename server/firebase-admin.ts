import admin from 'firebase-admin';

let initialized = false;

function ensureInitialized() {
  if (!initialized) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GCP_SA_KEY;
    if (serviceAccountJson) {
      let serviceAccount: admin.ServiceAccount;
      try {
        serviceAccount = JSON.parse(serviceAccountJson);
      } catch (e) {
        throw new Error('[Firebase] Failed to parse service account JSON');
      }
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('[Firebase] Admin SDK initialized for project:', (serviceAccount as any).project_id);
    } else {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      console.log('[Firebase] Admin SDK initialized with Application Default Credentials');
    }
    initialized = true;
  }
}

export function getFirestore(): admin.firestore.Firestore {
  ensureInitialized();
  return admin.firestore();
}

export function getAdminAuth(): admin.auth.Auth {
  ensureInitialized();
  return admin.auth();
}

export function getStorage(): admin.storage.Storage {
  ensureInitialized();
  return admin.storage();
}

export function getMessaging(): admin.messaging.Messaging {
  ensureInitialized();
  return admin.messaging();
}
