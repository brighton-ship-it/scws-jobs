import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function buildQuery(supabase: any, { search, type, activeOnly }: { search: string; type: string | null; activeOnly: boolean }) {
  let query = supabase
    .from('products')
    .select('*')
    .order('name', { ascending: true });

  if (activeOnly) {
    query = query.eq('active', true);
  }
  if (type) {
    query = query.eq('item_type', type);
  }
  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,sku.ilike.%${search}%`);
  }
  return query;
}

export async function GET(request: Request) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);

    const search = searchParams.get('search') || '';
    const type = searchParams.get('type');
    const activeOnly = searchParams.get('active') !== 'false';
    const limit = parseInt(searchParams.get('limit') || '100');

    const safeLimit = Math.min(limit, 5000);
    const PAGE_SIZE = 1000;
    let allProducts: any[] = [];
    let offset = 0;

    // Supabase PostgREST caps at 1000 rows per request, so paginate
    while (offset < safeLimit) {
      const batchSize = Math.min(PAGE_SIZE, safeLimit - offset);
      const { data, error } = await buildQuery(supabase, { search, type, activeOnly })
        .range(offset, offset + batchSize - 1);

      if (error) {
        console.error('Products fetch error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (!data || data.length === 0) break;
      allProducts = allProducts.concat(data);
      if (data.length < batchSize) break;
      offset += batchSize;
    }

    return NextResponse.json({ products: allProducts });
  } catch (error) {
    console.error('Products API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}
