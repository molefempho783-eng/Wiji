import React, { createContext, useState, useEffect, useContext } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebaseConfig"; // Ensure Firebase is set up

interface AuthContextType {
  user: User | null;
  /** True until Firebase has told us whether someone is already signed in (saved login). */
  initializing: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, initializing: true });

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setInitializing(false);
    });
    return () => unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ user, initializing }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
