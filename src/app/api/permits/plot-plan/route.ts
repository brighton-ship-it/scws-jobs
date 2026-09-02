import { NextRequest, NextResponse } from 'next/server';
import { renderPlotPlanPdf } from '@/lib/permits/plot-plan';
import type { ResearchResult } from '@/lib/permits/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = body?.result as ResearchResult | undefined;
    if (!result) {
      return NextResponse.json({ error: 'Research result is required' }, { status: 400 });
    }

    const pdfBytes = await renderPlotPlanPdf({
      result,
      proposedWell: body.proposedWell || result.proposedWell || null,
      manualSeptic: body.manualSeptic || null,
    });

    const apn = result.parcel?.apn?.replace(/[^a-zA-Z0-9]/g, '') || 'property';
    const filename = `plot-plan-${apn}-${new Date().toISOString().slice(0, 10)}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
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
