'use client';

import { format, parseISO, isToday, isPast } from 'date-fns';
import { Calendar, Clock, User, AlertCircle, CheckCircle2 } from 'lucide-react';
import { TaskStatusBadge, TaskPriorityBadge } from './TaskStatusBadge';
import type { Task, TaskWithDetails } from '@/types/database';

interface TaskCardProps {
  task: Task | TaskWithDetails;
  onClick?: () => void;
  compact?: boolean;
  showStatus?: boolean;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function isOverdue(task: Task): boolean {
  if (!task.due_date || task.status === 'completed') return false;
  return isPast(parseISO(task.due_date)) && !isToday(parseISO(task.due_date));
}

export function TaskCard({ task, onClick, compact = false, showStatus = true }: TaskCardProps) {
  const taskWithDetails = task as TaskWithDetails;
  const assignedUser = taskWithDetails.assigned_user;
  const relatedCustomer = taskWithDetails.related_customer;
  const overdue = isOverdue(task);
  const dueToday = task.due_date && isToday(parseISO(task.due_date));

  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`
          p-3 bg-white rounded-lg border shadow-sm hover:shadow-md transition-all cursor-pointer
          ${overdue ? 'border-red-300 bg-red-50' : dueToday ? 'border-blue-300' : 'border-gray-200'}
          ${task.status === 'completed' ? 'opacity-60' : ''}
        `}
      >
        <div className="flex items-start gap-2">
          {/* Assignee Avatar */}
          {assignedUser ? (
            <div className="h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-medium shrink-0">
              {getInitials(assignedUser.name)}
            </div>
          ) : (
            <div className="h-7 w-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-xs shrink-0">
              <User className="h-4 w-4" />
            </div>
          )}
          
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium truncate ${task.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'}`}>
              {task.title}
            </p>
            
            {task.due_date && (
              <div className={`flex items-center gap-1 mt-1 text-xs ${overdue ? 'text-red-600' : 'text-gray-500'}`}>
                {overdue && <AlertCircle className="h-3 w-3" />}
                <Calendar className="h-3 w-3" />
                <span>
                  {dueToday ? 'Today' : format(parseISO(task.due_date), 'MMM d')}
                  {task.due_time && ` at ${task.due_time}`}
                </span>
              </div>
            )}
          </div>
          
          {task.status === 'completed' && (
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`
        p-4 bg-white rounded-lg border shadow-sm hover:shadow-md transition-all cursor-pointer
        ${overdue ? 'border-red-300 bg-red-50' : 'border-gray-200'}
        ${task.status === 'completed' ? 'opacity-70' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Assignee Avatar */}
          {assignedUser ? (
            <div className="h-9 w-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-medium shrink-0">
              {getInitials(assignedUser.name)}
            </div>
          ) : (
            <div className="h-9 w-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">
              <User className="h-5 w-5" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className={`font-medium ${task.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'}`}>
              {task.title}
            </p>
            
            {task.description && (
              <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                {task.description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-500">
              {task.due_date && (
                <div className={`flex items-center gap-1 ${overdue ? 'text-red-600 font-medium' : ''}`}>
                  {overdue && <AlertCircle className="h-3.5 w-3.5" />}
                  <Calendar className="h-3.5 w-3.5" />
                  <span>
                    {dueToday ? 'Today' : format(parseISO(task.due_date), 'MMM d, yyyy')}
                  </span>
                </div>
              )}
              
              {task.due_time && (
                <div className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{task.due_time}</span>
                </div>
              )}

              {assignedUser && (
                <div className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  <span>{assignedUser.name}</span>
                </div>
              )}

              {relatedCustomer && (
                <span className="text-blue-600">
                  {relatedCustomer.name}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          {showStatus && <TaskStatusBadge status={task.status} />}
          {task.priority !== 'normal' && (
            <TaskPriorityBadge priority={task.priority} />
          )}
        </div>
      </div>
    </div>
  );
}
