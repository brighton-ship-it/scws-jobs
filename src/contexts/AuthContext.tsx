'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@/types/database';
import { mockUsers } from '@/lib/mock-data';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  isOffice: boolean;
  isTech: boolean;
  isField: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Check if we're using mock data (no Supabase credentials)
const useMockAuth = !process.env.NEXT_PUBLIC_SUPABASE_URL || 
                    process.env.NEXT_PUBLIC_SUPABASE_URL === 'your-supabase-url';

// Key for tracking mock auth session in localStorage
const MOCK_AUTH_KEY = 'scws_mock_auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (useMockAuth) {
      // Check if user explicitly signed out
      const mockAuthState = typeof window !== 'undefined' 
        ? localStorage.getItem(MOCK_AUTH_KEY) 
        : null;
      
      if (mockAuthState === 'signed_out') {
        // User signed out, stay signed out
        setUser(null);
      } else {
        // Auto-login with mock admin user for development
        setUser(mockUsers[0]);
        if (typeof window !== 'undefined') {
          localStorage.setItem(MOCK_AUTH_KEY, 'signed_in');
        }
      }
      setLoading(false);
      return;
    }

    const supabase = createClient();

    // Helper to fetch user profile via API (bypasses RLS)
    const fetchUserProfile = async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        return data.user;
      } catch (error) {
        console.error('Error fetching user profile:', error);
        return null;
      }
    };

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const profile = await fetchUserProfile();
        setUser(profile);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          const profile = await fetchUserProfile();
          setUser(profile);
        } else {
          setUser(null);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    if (useMockAuth) {
      const mockUser = mockUsers.find(u => u.email === email);
      if (mockUser) {
        setUser(mockUser);
        if (typeof window !== 'undefined') {
          localStorage.setItem(MOCK_AUTH_KEY, 'signed_in');
        }
        return { error: null };
      }
      // In demo mode, accept any email/password
      setUser(mockUsers[0]);
      if (typeof window !== 'undefined') {
        localStorage.setItem(MOCK_AUTH_KEY, 'signed_in');
      }
      return { error: null };
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    if (useMockAuth) {
      setUser(null);
      if (typeof window !== 'undefined') {
        localStorage.setItem(MOCK_AUTH_KEY, 'signed_out');
      }
      // Redirect to login page
      window.location.href = '/login';
      return;
    }

    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    window.location.href = '/login';
  };

  const value = {
    user,
    loading,
    signIn,
    signOut,
    isAdmin: user?.role === 'admin',
    isOffice: user?.role === 'office',
    isTech: user?.role === 'tech' || user?.role === 'field',
    isField: user?.role === 'field' || user?.role === 'tech',
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
