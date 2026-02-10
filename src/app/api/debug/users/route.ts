import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// Temporary debug endpoint - remove after fixing notifications
export async function GET() {
  try {
    const supabase = createServiceClient();
    
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, name, role')
      .in('role', ['admin', 'office']);
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ 
      adminOfficeUsers: users?.length || 0,
      users: users?.map(u => ({ id: u.id, email: u.email, role: u.role })) || []
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
