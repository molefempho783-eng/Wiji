// firebaseConfig.ts
import { Platform } from 'react-native';
import { initializeApp } from 'firebase/app';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from "firebase/functions";

// Auth (RN persistence)
import { initializeAuth, getAuth } from 'firebase/auth';
// @ts-expect-error: RN export exists at runtime; typing quirk
import { getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const firebaseConfig = {
    apiKey: "AIzaSyB91UEqTJVnNcg8Jsy0_6FsvqG9A6irEkE",
    authDomain: "communitychat-f3fb0.firebaseapp.com",
    projectId: "communitychat-f3fb0",
    storageBucket: "communitychat-f3fb0.firebasestorage.app",
    messagingSenderId: "975021405125",
    appId: "1:975021405125:web:9560540eb3d567dfad91ac",
    measurementId: "G-311RJN9VQ9",
    // Required by React Native Firebase native SDK (e.g. for messaging); safe to add for JS SDK too
    databaseURL: "https://communitychat-f3fb0-default-rtdb.firebaseio.com",
};

export const app = initializeApp(firebaseConfig);
export const functions = getFunctions(app);

export const auth =
  Platform.OS === 'web'
    ? getAuth(app) // web uses default persistence (IndexedDB/localStorage)
    : initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });

// On React Native, Firestore's default streaming connection often stalls (lists never load,
// especially on Android emulators and mobile networks). Long polling is much more reliable there.
function createDb() {
  if (Platform.OS === 'web') return getFirestore(app);
  try {
    return initializeFirestore(app, { experimentalForceLongPolling: true });
  } catch {
    return getFirestore(app); // already initialised (e.g. after a hot reload)
  }
}
export const db = createDb();

// ✅ Export Storage so screens can import it
export const storage = getStorage(app);