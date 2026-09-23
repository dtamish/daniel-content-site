import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type User } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const config = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY?.trim(),
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID?.trim(),
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET?.trim(),
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID?.trim(),
};
export const isFirebaseConfigured = Object.values(config).every(Boolean);
let app: FirebaseApp | undefined;
let signingIn: Promise<User> | undefined;

export function firebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured) throw new Error('Firebase configuration is missing. Set PUBLIC_FIREBASE_* before publishing.');
  return app ??= getApps().length ? getApp() : initializeApp(config as Required<typeof config>);
}
export const firestore = () => getFirestore(firebaseApp());
export const storage = () => getStorage(firebaseApp());

// The anonymous uid is the active profile/review identity; never use a local reviewer id
// to authenticate writes. Auth state may still be restoring from IndexedDB at startup.
export async function anonymousUser(): Promise<User> {
  const auth = getAuth(firebaseApp());
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  return signingIn ??= signInAnonymously(auth).then(({ user }) => user).finally(() => { signingIn = undefined; });
}
