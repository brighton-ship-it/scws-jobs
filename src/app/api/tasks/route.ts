import { NextRequest, NextResponse } from 'next/server';
import { createSessionClient, createServiceClient } from '@/lib/supabase/service';
import type { Task, TaskStatus, TaskPriority } from '@/types/database';

/**
 * GET /api/tasks - List all tasks with optional filters
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const assignedTo = searchParams.get('assigned_to');
  const priority = searchParams.get('priority');
  const limit = parseInt(searchParams.get('limit') || '100');
  const includeCompleted = searchParams.get('include_completed') === 'true';

  const supabase = createSessionClient();

  let query = supabase
    .from('tasks')
    .select(`
      *,
      assigned_user:users!tasks_assigned_to_fkey(id, name, email),
      related_customer:customers(id, name),
      related_job:jobs(id, job_type, status)
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  // Filter by status
  if (status && status !== 'all') {
    query = query.eq('status', status);
  } else if (!includeCompleted) {
    // By default, exclude completed tasks unless explicitly requested
    query = query.neq('status', 'completed');
  }

  // Filter by assignee
  if (assignedTo) {
    query = query.eq('assigned_to', assignedTo);
  }

  // Filter by priority
  if (priority && priority !== 'all') {
    query = query.eq('priority', priority);
  }

  const { data: tasks, error } = await query;

  if (error) {
    console.error('Error fetching tasks:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Calculate stats
  const allTasksQuery = await supabase
    .from('tasks')
    .select('status, priority, due_date')
    .neq('status', 'completed');
  
  const allTasks = allTasksQuery.data || [];
  const today = new Date().toISOString().split('T')[0];
  
  const stats = {
    pending: allTasks.filter(t => t.status === 'pending').length,
    in_progress: allTasks.filter(t => t.status === 'in_progress').length,
    overdue: allTasks.filter(t => t.due_date && t.due_date < today).length,
    urgent: allTasks.filter(t => t.priority === 'urgent').length,
  };

  return NextResponse.json({ tasks, stats });
}

/**
 * POST /api/tasks - Create a new task
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, assigned_to, due_date, due_time, priority, related_job_id, related_customer_id } = body;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const supabase = createSessionClient();

    // Get current user for created_by
    const { data: { user } } = await supabase.auth.getUser();

    const { data: task, error } = await supabase
      .from('tasks')
      .insert({
        title,
        description: description || null,
        assigned_to: assigned_to || null,
        due_date: due_date || null,
        due_time: due_time || null,
        status: 'pending' as TaskStatus,
        priority: (priority || 'normal') as TaskPriority,
        related_job_id: related_job_id || null,
        related_customer_id: related_customer_id || null,
        created_by: user?.id || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating task:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ task });
  } catch (err) {
    console.error('Task creation error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
