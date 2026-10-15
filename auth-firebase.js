// Firebase Auth की सारी लॉजिक यहां है। UI की फ़ाइल सिर्फ़ इन्हीं फ़ंक्शन को बुलाती है।
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence, browserSessionPersistence,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile,
  sendEmailVerification, sendPasswordResetEmail, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD_6BP1eeFl7hlkuHnljJkLanB7N6Od2SM",
  authDomain: "procase--manager.firebaseapp.com",
  projectId: "procase--manager",
  storageBucket: "procase--manager.firebasestorage.app",
  messagingSenderId: "894543154228",
  appId: "1:894543154228:web:fa7087e09aba5593904e61",
  measurementId: "G-4FBRLCJC8H"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = "hi";

const ERRORS = {
  "auth/invalid-credential": "ईमेल या पासवर्ड ग़लत है। दोबारा जांचें।",
  "auth/wrong-password": "पासवर्ड ग़लत है।",
  "auth/user-not-found": "इस ईमेल से कोई खाता नहीं मिला। पहले खाता बनाएं।",
  "auth/invalid-email": "ईमेल का फ़ॉर्मैट सही नहीं है।",
  "auth/email-already-in-use": "इस ईमेल से खाता पहले से है। लॉग इन करें।",
  "auth/weak-password": "पासवर्ड कमज़ोर है। 8 या ज़्यादा अक्षर और एक अंक रखें।",
  "auth/user-disabled": "यह खाता बंद कर दिया गया है।",
  "auth/too-many-requests": "बहुत कोशिशें हो गईं। कुछ मिनट रुककर फिर करें।",
  "auth/network-request-failed": "इंटरनेट नहीं है। कनेक्शन जांचकर फिर करें।",
  "auth/popup-closed-by-user": "Google की विंडो बंद हो गई। फिर कोशिश करें।",
  "auth/cancelled-popup-request": "Google की विंडो बंद हो गई। फिर कोशिश करें।",
  "auth/account-exists-with-different-credential": "इस ईमेल से खाता पहले किसी और तरीके से बना है। उसी तरीके से लॉग इन करें।",
  "auth/operation-not-allowed": "Email/Password लॉग इन चालू नहीं है। Firebase Console में चालू करें।"
};
export const errorText = (e) => ERRORS[e && e.code] || "कुछ गड़बड़ हुई। थोड़ी देर बाद फिर कोशिश करें।";

export async function logIn(email, password, remember) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  return (await signInWithEmailAndPassword(auth, email, password)).user;
}

export async function signUp(name, email, password) {
  await setPersistence(auth, browserLocalPersistence);
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(user, { displayName: name });
  try { await sendEmailVerification(user); } catch (_) { /* वेरिफ़िकेशन मेल न जाए तो भी खाता बन चुका है */ }
  return user;
}

export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export const onUser = (cb) => onAuthStateChanged(auth, cb);

// Google लॉग इन: पहले popup, न चले (ऐप/ब्राउज़र रोके) तो redirect
export async function googleSignIn() {
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    return (await signInWithPopup(auth, provider)).user;
  } catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw e;
  }
}
export const redirectResult = () => getRedirectResult(auth);
