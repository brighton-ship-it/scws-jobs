import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import {
  createTechNoteQuote,
  TechNoteDoNotQuoteError,
  UnclearTechNoteIntentError,
} from '@/lib/jobber/tech-note-quote';
import type { TechNoteKind } from '@/lib/jobber/tech-note-intent';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * POST /api/jobber/tech-note-quote
 * Auth: Authorization: Bearer <CRON_SECRET>
 * Creates ONE unsent Jobber quote draft from tech-note intent. Never sends.
 * Does not default to a $600 pull-and-eval.
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
      kind?: TechNoteKind | 'replace';
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
    if (error instanceof TechNoteDoNotQuoteError) {
      return NextResponse.json(
        {
          error: 'do_not_quote',
          reason: error.reason,
          message: error.message,
          equipment: error.equipment,
          sentAt: null,
          draft: true,
        },
        { status: 400 }
      );
    }
    if (error instanceof UnclearTechNoteIntentError) {
      return NextResponse.json(
        {
          error: 'unclear_intent',
          message: error.message,
          guesses: error.guesses,
          equipment: error.equipment,
          sentAt: null,
          draft: true,
        },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to create tech-note quote';
    const status = /not found|required|refusing/i.test(message) ? 400 : 500;
    console.error('[tech-note-quote]', message);
    return NextResponse.json({ error: message, sentAt: null, draft: true }, { status });
  }
}
