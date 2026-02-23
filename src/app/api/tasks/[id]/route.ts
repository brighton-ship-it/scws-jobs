import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import type { TaskStatus, TaskPriority } from '@/types/database';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/tasks/[id] - Get a single task
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = createServiceClient();

  const { data: task, error } = await supabase
    .from('tasks')
    .select(`
      *,
      assigned_user:users!tasks_assigned_to_fkey(id, name, email),
      related_customer:customers(id, name, phone),
      related_job:jobs(id, job_type, status, property_id)
    `)
    .eq('id', id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json({ task });
}

/**
 * PATCH /api/tasks/[id] - Update a task
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  
  try {
    const body = await request.json();
    const { title, description, assigned_to, due_date, due_time, status, priority, related_job_id, related_customer_id } = body;

    const supabase = createServiceClient();

    // Build update object with only provided fields
    const updates: Record<string, any> = {};
    
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;
    if (due_date !== undefined) updates.due_date = due_date;
    if (due_time !== undefined) updates.due_time = due_time;
    if (status !== undefined) {
      updates.status = status as TaskStatus;
      // Set completed_at when marking as completed
      if (status === 'completed') {
        updates.completed_at = new Date().toISOString();
      } else {
        updates.completed_at = null;
      }
    }
    if (priority !== undefined) updates.priority = priority as TaskPriority;
    if (related_job_id !== undefined) updates.related_job_id = related_job_id;
    if (related_customer_id !== undefined) updates.related_customer_id = related_customer_id;

    const { data: task, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating task:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ task });
  } catch (err) {
    console.error('Task update error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks/[id] - Delete a task
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting task:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
