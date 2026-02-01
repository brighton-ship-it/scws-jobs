'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wrench } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // For demo without Supabase, accept any login
    // In production, this would use Supabase auth
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    if (!email || !password) {
      setError('Please enter email and password');
      setLoading(false);
      return;
    }

    // Redirect to dashboard
    router.push('/');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-600">
              <Wrench className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">SCWS</h1>
              <p className="text-sm text-slate-400">Job Management</p>
            </div>
          </div>
          <p className="text-slate-400">Southern California Well Service</p>
        </div>

        {/* Login Form */}
        <div className="rounded-xl bg-white p-8 shadow-xl">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="you@scwellservice.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          {/* Demo credentials hint */}
          <div className="mt-6 rounded-lg bg-blue-50 p-4 text-sm">
            <p className="font-medium text-blue-800 mb-1">Demo Mode</p>
            <p className="text-blue-600">
              Supabase not connected. Any email/password will work for testing.
            </p>
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          &copy; {new Date().getFullYear()} Southern California Well Service
        </p>
      </div>
    </div>
  );
}
