// Tasks CRUD operations (using mock data for now)
import type { Task, TaskWithDetails, TaskStatus, TaskPriority } from '@/types/database';
import { 
  mockTasks, 
  getTaskById, 
  getTaskWithDetails,
  getTasksByAssignee,
  getUnscheduledTasks,
  getScheduledTasks,
  getTasksForDate,
  getPendingTasks,
  getTasksByCustomerId,
  getTasksByJobId,
  getUserById,
  getJobById,
  getCustomerById,
} from './mock-data';

export interface CreateTaskInput {
  title: string;
  description?: string;
  assigned_to?: string;
  due_date?: string;
  due_time?: string;
  priority?: TaskPriority;
  related_job_id?: string;
  related_customer_id?: string;
  created_by?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  assigned_to?: string;
  due_date?: string | null;
  due_time?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  related_job_id?: string | null;
  related_customer_id?: string | null;
}

// Re-export helper functions
export {
  getTaskById,
  getTaskWithDetails,
  getTasksByAssignee,
  getUnscheduledTasks,
  getScheduledTasks,
  getTasksForDate,
  getPendingTasks,
  getTasksByCustomerId,
  getTasksByJobId,
};

// Get all tasks with details
export function getAllTasks(): Task[] {
  return [...mockTasks];
}

export function getAllTasksWithDetails(): TaskWithDetails[] {
  return mockTasks.map(task => ({
    ...task,
    assigned_user: task.assigned_to ? getUserById(task.assigned_to) || null : null,
    related_job: task.related_job_id ? getJobById(task.related_job_id) || null : null,
    related_customer: task.related_customer_id ? getCustomerById(task.related_customer_id) || null : null,
  }));
}

// Create a new task
export function createTask(input: CreateTaskInput): Task {
  const newTask: Task = {
    id: `t${Date.now()}`,
    title: input.title,
    description: input.description || null,
    assigned_to: input.assigned_to || null,
    due_date: input.due_date || null,
    due_time: input.due_time || null,
    status: 'pending',
    priority: input.priority || 'normal',
    related_job_id: input.related_job_id || null,
    related_customer_id: input.related_customer_id || null,
    created_by: input.created_by || null,
    created_at: new Date().toISOString(),
    completed_at: null,
  };
  
  mockTasks.push(newTask);
  return newTask;
}

// Update a task
export function updateTask(id: string, input: UpdateTaskInput): Task | null {
  const taskIndex = mockTasks.findIndex(t => t.id === id);
  if (taskIndex === -1) return null;
  
  const task = mockTasks[taskIndex];
  const updatedTask: Task = {
    ...task,
    ...input,
    // Handle status change to completed
    completed_at: input.status === 'completed' && task.status !== 'completed' 
      ? new Date().toISOString() 
      : input.status !== 'completed' ? null : task.completed_at,
  };
  
  mockTasks[taskIndex] = updatedTask;
  return updatedTask;
}

// Delete a task
export function deleteTask(id: string): boolean {
  const taskIndex = mockTasks.findIndex(t => t.id === id);
  if (taskIndex === -1) return false;
  
  mockTasks.splice(taskIndex, 1);
  return true;
}

// Mark task as complete
export function completeTask(id: string): Task | null {
  return updateTask(id, { 
    status: 'completed',
  });
}

// Get overdue tasks
export function getOverdueTasks(): Task[] {
  const today = new Date().toISOString().split('T')[0];
  return mockTasks.filter(task => 
    task.due_date && 
    task.due_date < today && 
    task.status !== 'completed'
  );
}

// Get tasks due today
export function getTasksDueToday(): Task[] {
  const today = new Date().toISOString().split('T')[0];
  return getTasksForDate(today);
}

// Get tasks by status
export function getTasksByStatus(status: TaskStatus): Task[] {
  return mockTasks.filter(t => t.status === status);
}

// Get tasks by priority
export function getTasksByPriority(priority: TaskPriority): Task[] {
  return mockTasks.filter(t => t.priority === priority && t.status !== 'completed');
}

// Helper to check if task is overdue
export function isTaskOverdue(task: Task): boolean {
  if (!task.due_date || task.status === 'completed') return false;
  const today = new Date().toISOString().split('T')[0];
  return task.due_date < today;
}

// Helper to check if task is due today
export function isTaskDueToday(task: Task): boolean {
  if (!task.due_date) return false;
  const today = new Date().toISOString().split('T')[0];
  return task.due_date === today;
}
