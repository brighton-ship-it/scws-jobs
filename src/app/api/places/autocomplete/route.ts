import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const input = searchParams.get('input');
  
  if (!input) {
    return NextResponse.json({ predictions: [] });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Maps API key not configured' }, { status: 500 });
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=address&components=country:us&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    
    return NextResponse.json({ predictions: data.predictions || [] });
  } catch (error) {
    console.error('Places autocomplete error:', error);
    return NextResponse.json({ predictions: [] });
  }
}
