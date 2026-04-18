import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { 
  getAuth, signInAnonymously, GoogleAuthProvider, 
  signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, signOut as fbSignOut 
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBXsTPyfCOBTxBYAV6psyI3pn8UUcO1YRo",
  authDomain: "babymonitor-85946.firebaseapp.com",
  databaseURL: "https://babymonitor-85946-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "babymonitor-85946",
  storageBucket: "babymonitor-85946.firebasestorage.app",
  messagingSenderId: "722437897762",
  appId: "1:722437897762:web:2b80a2997b186ac94dd47b",
  measurementId: "G-30Q7Q0CQ2B"
};

const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Sign in with Google
export const signInWithGoogle = async () => {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err) {
    if (err.code === 'auth/popup-blocked' || 
        err.code === 'auth/popup-closed-by-user' ||
        err.code === 'auth/cancelled-popup-request') {
      return signInWithRedirect(auth, googleProvider);
    }
    throw err;
  }
};

// Email/password sign-in (for dev/test)
export const signInWithEmail = (email, password) => 
  signInWithEmailAndPassword(auth, email, password);

export const signUpWithEmail = async (email, password, displayName) => {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  return cred;
};

export const handleRedirectResult = () => getRedirectResult(auth);
export const signOutUser = () => fbSignOut(auth);

// Ensure at least anonymous auth (for parents joining as guest)
export const ensureAuthenticated = async () => {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  return auth.currentUser;
};
