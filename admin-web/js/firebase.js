// Firebase for the admin website (same project as the Wiji app).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, onSnapshot, query, where, orderBy, limit,
  updateDoc, setDoc, addDoc, deleteDoc, deleteField, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage, ref, getDownloadURL, uploadBytes } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { firebaseConfig } from "./config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
const functions = getFunctions(app, "us-central1");

export {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  collection, doc, getDoc, getDocs, onSnapshot, query, where, orderBy, limit, ref, getDownloadURL,
  updateDoc, setDoc, addDoc, deleteDoc, deleteField, serverTimestamp, writeBatch, uploadBytes,
};

/** Call a Cloud Function and turn its error into a readable message. */
export async function call(name, data = {}) {
  try {
    return (await httpsCallable(functions, name)(data)).data;
  } catch (e) {
    throw new Error(String(e?.message || "Something went wrong.").replace(/^.*?:\s*/, ""));
  }
}

/** Download URL for a file in Storage (cached). */
const urlCache = new Map();
export function fileUrl(path) {
  if (!urlCache.has(path)) urlCache.set(path, getDownloadURL(ref(storage, path)));
  return urlCache.get(path);
}

/** Display name for a user id (cached). */
const nameCache = new Map();
export function userName(uid) {
  if (!uid) return Promise.resolve("—");
  if (!nameCache.has(uid)) {
    nameCache.set(
      uid,
      getDoc(doc(db, "users", uid))
        .then((s) => (s.exists() ? s.data().username || s.data().email || uid.slice(0, 8) : uid.slice(0, 8)))
        .catch(() => uid.slice(0, 8))
    );
  }
  return nameCache.get(uid);
}
