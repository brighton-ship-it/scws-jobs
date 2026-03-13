import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get('place_id');
  
  if (!placeId) {
    return NextResponse.json({ error: 'place_id required' }, { status: 400 });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Maps API key not configured' }, { status: 500 });
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=address_components,formatted_address&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.result?.address_components) {
      const components = data.result.address_components;
      const get = (type: string) => components.find((c: any) => c.types.includes(type));
      
      const streetNumber = get('street_number')?.long_name || '';
      const route = get('route')?.long_name || '';
      const city = get('locality')?.long_name || get('sublocality')?.long_name || '';
      const zip = get('postal_code')?.long_name || '';
      
      return NextResponse.json({
        result: {
          address: `${streetNumber} ${route}`.trim(),
          city,
          zip,
          formatted: data.result.formatted_address,
        }
      });
    }
    
    return NextResponse.json({ result: null });
  } catch (error) {
    console.error('Places details error:', error);
    return NextResponse.json({ result: null });
  }
}
