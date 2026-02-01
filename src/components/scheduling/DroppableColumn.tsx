'use client';

import { useDroppable } from '@dnd-kit/core';
import { ReactNode } from 'react';

interface DroppableColumnProps {
  id: string;
  children: ReactNode;
}

export function DroppableColumn({ id, children }: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`
        min-h-[100px] rounded-lg transition-colors
        ${isOver ? 'bg-blue-50 ring-2 ring-blue-300' : ''}
      `}
    >
      {children}
    </div>
  );
}
