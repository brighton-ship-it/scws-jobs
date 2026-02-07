import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get the authenticated user's session
    const supabase = createServiceClient();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session?.user?.email) {
      return NextResponse.json({ user: null });
    }
    
    // Use service role to fetch user profile (bypasses RLS)
    const serviceClient = createServiceClient();
    const { data: profile, error: profileError } = await serviceClient
      .from('users')
      .select('*')
      .eq('email', session.user.email)
      .single();
    
    if (profileError) {
      console.error('Error fetching user profile:', profileError);
      return NextResponse.json({ user: null, error: profileError.message });
    }
    
    return NextResponse.json({ user: profile });
  } catch (error) {
    console.error('Auth me error:', error);
    return NextResponse.json({ user: null, error: 'Failed to fetch user' });
  }
}
