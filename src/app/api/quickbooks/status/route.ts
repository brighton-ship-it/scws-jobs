import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getQBOConnectionStatus } from '@/lib/quickbooks/service';

export async function GET() {
  try {
    const status = await getQBOConnectionStatus();
    
    if (!status) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    return NextResponse.json(status);
  } catch (error) {
    console.error('QuickBooks status error:', error);
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    // Use session-aware client to get user
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Use service client for database operations (bypasses RLS)
    const supabase = createServiceClient();

    // Delete the connection
    const { error } = await supabase
      .from('quickbooks_connections')
      .delete()
      .eq('user_id', user.id);

    if (error) {
      console.error('Failed to disconnect QuickBooks:', error);
      return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('QuickBooks disconnect error:', error);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
}
