import { NextRequest, NextResponse } from 'next/server';
import { renderPlotPlanPdf, renderPlotPlanPng } from '@/lib/permits/plot-plan';
import type { ResearchResult } from '@/lib/permits/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = body?.result as ResearchResult | undefined;
    if (!result) {
      return NextResponse.json({ error: 'Research result is required' }, { status: 400 });
    }

    const payload = {
      result,
      proposedWell: body.proposedWell || result.proposedWell || null,
      manualSeptic: body.manualSeptic || null,
    };
    const apn = result.parcel?.apn?.replace(/[^a-zA-Z0-9]/g, '') || 'property';
    const stamp = new Date().toISOString().slice(0, 10);

    if (body.format === 'png') {
      const png = await renderPlotPlanPng(payload);
      return new NextResponse(Buffer.from(png), {
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': `attachment; filename="plot-plan-${apn}-${stamp}.png"`,
        },
      });
    }

    const pdfBytes = await renderPlotPlanPdf(payload);
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="plot-plan-${apn}-${stamp}.pdf"`,
      },
    });
  } catch (error) {
    console.error('Plot plan PDF error:', error);
    return NextResponse.json(
      { error: 'Failed to generate plot plan', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
