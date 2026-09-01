import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import { createTechNoteQuote } from '@/lib/jobber/tech-note-quote';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * POST /api/jobber/tech-note-quote
 * Auth: Authorization: Bearer <CRON_SECRET>
 * Creates ONE unsent Jobber quote draft for an existing job. Never sends.
 */
export async function POST(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (!cronAuth.ok) {
    cronUnauthorizedLog(cronAuth.reason);
    return unauthorized();
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      jobNumber?: string | number;
      jobId?: string;
      techNotes?: string;
      notes?: string;
      kind?: 'pull_and_eval' | 'replace';
    };

    const result = await createTechNoteQuote({
      jobNumber: body.jobNumber,
      jobId: body.jobId,
      techNotes: body.techNotes ?? body.notes,
      kind: body.kind,
    });

    return NextResponse.json({
      ...result,
      sentAt: null,
      draft: true,
      note: 'Drafts stay unsent. sentAt is null. transitionQuoteTo was not set.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create tech-note quote';
    const status = /not found|required|refusing/i.test(message) ? 400 : 500;
    console.error('[tech-note-quote]', message);
    return NextResponse.json({ error: message, sentAt: null, draft: true }, { status });
  }
}
