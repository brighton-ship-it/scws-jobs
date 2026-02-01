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
  isField: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Check if we're using mock data (no Supabase credentials)
const useMockAuth = !process.env.NEXT_PUBLIC_SUPABASE_URL || 
                    process.env.NEXT_PUBLIC_SUPABASE_URL === 'your-supabase-url';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (useMockAuth) {
      // Use mock admin user for development
      setUser(mockUsers[0]);
      setLoading(false);
      return;
    }

    const supabase = createClient();

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        // Fetch user profile from our users table
        const { data: profile } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single();
        
        setUser(profile);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .single();
          
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
        return { error: null };
      }
      return { error: new Error('Invalid credentials') };
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    if (useMockAuth) {
      setUser(null);
      return;
    }

    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
  };

  const value = {
    user,
    loading,
    signIn,
    signOut,
    isAdmin: user?.role === 'admin',
    isOffice: user?.role === 'office',
    isField: user?.role === 'field',
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
