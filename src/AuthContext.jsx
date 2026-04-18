import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, signInWithGoogle, signInWithEmail, signUpWithEmail, signOutUser } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsub;
  }, []);

  const signIn = async () => {
    try {
      await signInWithGoogle();
    } catch (e) {
      console.error('Google sign-in failed', e);
      throw e;
    }
  };

  const emailSignIn = async (email, password) => {
    try {
      await signInWithEmail(email, password);
    } catch (e) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
        // Auto-create account on first use
        const name = email.split('@')[0];
        await signUpWithEmail(email, password, name);
      } else {
        throw e;
      }
    }
  };

  const signOut = async () => {
    await signOutUser();
    setUser(null);
  };

  const isSignedIn = !!user && !user.isAnonymous;

  return (
    <AuthContext.Provider value={{ user, loading, isSignedIn, signIn, emailSignIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
