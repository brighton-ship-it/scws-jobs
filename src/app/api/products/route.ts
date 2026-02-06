import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);

    const search = searchParams.get('search') || '';
    const type = searchParams.get('type'); // 'part', 'service', 'labor', 'equipment'
    const activeOnly = searchParams.get('active') !== 'false';
    const limit = parseInt(searchParams.get('limit') || '100');

    let query = supabase
      .from('products')
      .select('*')
      .order('name', { ascending: true });

    // Filter by active status
    if (activeOnly) {
      query = query.eq('active', true);
    }

    // Filter by type
    if (type) {
      query = query.eq('item_type', type);
    }

    // Search by name, description, or SKU
    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,sku.ilike.%${search}%`);
    }

    // Limit results (max 2000 to avoid memory issues)
    const safeLimit = Math.min(limit, 2000);
    query = query.limit(safeLimit);

    const { data: products, error, count } = await query;

    if (error) {
      console.error('Products fetch error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ products: products || [] });
  } catch (error) {
    console.error('Products API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}
