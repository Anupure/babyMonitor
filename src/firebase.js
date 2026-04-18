import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";

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

// Helper to ensure user is signed in anonymously
export const ensureAuthenticated = async () => {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  return auth.currentUser;
};
