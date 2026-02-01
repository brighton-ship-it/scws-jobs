'use client';

import { useState } from 'react';
import { TaskCard } from './TaskCard';
import { TaskDetailModal } from './TaskDetailModal';
import type { Task, TaskWithDetails } from '@/types/database';

interface TaskListProps {
  tasks: (Task | TaskWithDetails)[];
  compact?: boolean;
  showStatus?: boolean;
  emptyMessage?: string;
  onTaskUpdated?: () => void;
}

export function TaskList({ 
  tasks, 
  compact = false, 
  showStatus = true,
  emptyMessage = 'No tasks',
  onTaskUpdated,
}: TaskListProps) {
  const [selectedTask, setSelectedTask] = useState<Task | TaskWithDetails | null>(null);

  if (tasks.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            compact={compact}
            showStatus={showStatus}
            onClick={() => setSelectedTask(task)}
          />
        ))}
      </div>

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onTaskUpdated={() => {
            onTaskUpdated?.();
            setSelectedTask(null);
          }}
        />
      )}
    </>
  );
}
