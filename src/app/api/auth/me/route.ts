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
    let { data: profile, error: profileError } = await serviceClient
      .from('users')
      .select('*')
      .eq('email', session.user.email)
      .single();
    
    // If no profile exists, auto-create one for the authenticated user
    if (profileError && profileError.code === 'PGRST116') {
      // Extract name from email or user metadata
      const email = session.user.email;
      const metadata = session.user.user_metadata || {};
      const name = metadata.full_name || metadata.name || email.split('@')[0];
      
      // Determine role - first user or specific emails get admin
      const adminEmails = ['brighton@scwellservice.com', 'info@scwellservice.com', 'shanicey@scwellservice.com'];
      const role = adminEmails.includes(email.toLowerCase()) ? 'admin' : 'office';
      
      const { data: newProfile, error: insertError } = await serviceClient
        .from('users')
        .insert({
          id: session.user.id,
          email: email,
          name: name,
          role: role,
        })
        .select()
        .single();
      
      if (insertError) {
        console.error('Error creating user profile:', insertError);
        return NextResponse.json({ user: null, error: insertError.message });
      }
      
      profile = newProfile;
    } else if (profileError) {
      console.error('Error fetching user profile:', profileError);
      return NextResponse.json({ user: null, error: profileError.message });
    }
    
    return NextResponse.json({ user: profile });
  } catch (error) {
    console.error('Auth me error:', error);
    return NextResponse.json({ user: null, error: 'Failed to fetch user' });
  }
}
