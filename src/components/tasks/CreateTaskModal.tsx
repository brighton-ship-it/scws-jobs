'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/FormElements';
import { mockUsers, mockCustomers } from '@/lib/mock-data';
import { createTask, type CreateTaskInput } from '@/lib/tasks';
import type { TaskPriority } from '@/types/database';

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskCreated?: () => void;
  defaultDate?: string;
  defaultAssignee?: string;
  defaultCustomerId?: string;
  defaultJobId?: string;
}

export function CreateTaskModal({
  isOpen,
  onClose,
  onTaskCreated,
  defaultDate,
  defaultAssignee,
  defaultCustomerId,
  defaultJobId,
}: CreateTaskModalProps) {
  const [formData, setFormData] = useState<CreateTaskInput>({
    title: '',
    description: '',
    assigned_to: defaultAssignee || '',
    due_date: defaultDate || '',
    due_time: '',
    priority: 'normal',
    related_customer_id: defaultCustomerId || '',
    related_job_id: defaultJobId || '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    setIsSubmitting(true);
    try {
      createTask({
        ...formData,
        assigned_to: formData.assigned_to || undefined,
        due_date: formData.due_date || undefined,
        due_time: formData.due_time || undefined,
        related_customer_id: formData.related_customer_id || undefined,
        related_job_id: formData.related_job_id || undefined,
        created_by: '1', // Mock current user
      });
      
      onTaskCreated?.();
      onClose();
      // Reset form
      setFormData({
        title: '',
        description: '',
        assigned_to: '',
        due_date: '',
        due_time: '',
        priority: 'normal',
        related_customer_id: '',
        related_job_id: '',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Create Task</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="What needs to be done?"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <Textarea
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Add more details..."
              rows={3}
            />
          </div>

          {/* Assigned To */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Assign To
            </label>
            <Select
              value={formData.assigned_to || ''}
              onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
            >
              <option value="">Unassigned</option>
              {mockUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </div>

          {/* Due Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Due Date
              </label>
              <Input
                type="date"
                value={formData.due_date || ''}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Due Time
              </label>
              <Input
                type="time"
                value={formData.due_time || ''}
                onChange={(e) => setFormData({ ...formData, due_time: e.target.value })}
              />
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Priority
            </label>
            <Select
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: e.target.value as TaskPriority })}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </div>

          {/* Related Customer */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Related Customer
            </label>
            <Select
              value={formData.related_customer_id || ''}
              onChange={(e) => setFormData({ ...formData, related_customer_id: e.target.value })}
            >
              <option value="">None</option>
              {mockCustomers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </Select>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !formData.title.trim()}
            >
              {isSubmitting ? 'Creating...' : 'Create Task'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
