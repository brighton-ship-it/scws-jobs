'use client';

import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { 
  X, 
  Calendar, 
  Clock, 
  User, 
  Building, 
  Briefcase,
  CheckCircle2,
  Trash2,
  Edit2,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/FormElements';
import { TaskStatusBadge, TaskPriorityBadge } from './TaskStatusBadge';
import type { Task, TaskWithDetails, TaskStatus, TaskPriority } from '@/types/database';

interface UserOption {
  id: string;
  name: string;
}

interface CustomerOption {
  id: string;
  name: string;
}

interface TaskDetailModalProps {
  task: Task | TaskWithDetails;
  isOpen: boolean;
  onClose: () => void;
  onTaskUpdated?: () => void;
}

export function TaskDetailModal({ task, isOpen, onClose, onTaskUpdated }: TaskDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    title: task.title,
    description: task.description || '',
    assigned_to: task.assigned_to || '',
    due_date: task.due_date || '',
    due_time: task.due_time || '',
    priority: task.priority,
    status: task.status,
    related_customer_id: task.related_customer_id || '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const taskWithDetails = task as TaskWithDetails;
  const assignedUser = taskWithDetails.assigned_user;
  const relatedCustomer = taskWithDetails.related_customer;
  const relatedJob = taskWithDetails.related_job;

  // Fetch users and customers when editing
  useEffect(() => {
    if (isEditing && users.length === 0) {
      const fetchOptions = async () => {
        setLoadingOptions(true);
        try {
          const [usersRes, customersRes] = await Promise.all([
            fetch('/api/users?active=true'),
            fetch('/api/customers?limit=100'),
          ]);
          
          if (usersRes.ok) {
            const data = await usersRes.json();
            setUsers(data.users || []);
          }
          if (customersRes.ok) {
            const data = await customersRes.json();
            setCustomers(data.customers || []);
          }
        } catch (error) {
          console.error('Failed to fetch options:', error);
        } finally {
          setLoadingOptions(false);
        }
      };
      fetchOptions();
    }
  }, [isEditing, users.length]);

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description || null,
          assigned_to: formData.assigned_to || null,
          due_date: formData.due_date || null,
          due_time: formData.due_time || null,
          priority: formData.priority,
          status: formData.status,
          related_customer_id: formData.related_customer_id || null,
        }),
      });

      if (res.ok) {
        onTaskUpdated?.();
        setIsEditing(false);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update task');
      }
    } catch (error) {
      console.error('Update task error:', error);
      alert('Failed to update task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleComplete = async () => {
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          completed_at: new Date().toISOString(),
        }),
      });

      if (res.ok) {
        onTaskUpdated?.();
      }
    } catch (error) {
      console.error('Complete task error:', error);
    }
  };

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this task?')) {
      try {
        const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
        if (res.ok) {
          onTaskUpdated?.();
          onClose();
        }
      } catch (error) {
        console.error('Delete task error:', error);
      }
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
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">
              {isEditing ? 'Edit Task' : 'Task Details'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && task.status !== 'completed' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(true)}
              >
                <Edit2 className="h-4 w-4" />
              </Button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {isEditing ? (
            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title
                </label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <Select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as TaskStatus })}
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </Select>
              </div>

              {/* Assigned To */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Assign To
                </label>
                {loadingOptions ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                ) : (
                  <Select
                    value={formData.assigned_to}
                    onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
                  >
                    <option value="">Unassigned</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>

              {/* Due Date & Time */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Due Date
                  </label>
                  <Input
                    type="date"
                    value={formData.due_date}
                    onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Due Time
                  </label>
                  <Input
                    type="time"
                    value={formData.due_time}
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
                {loadingOptions ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                ) : (
                  <Select
                    value={formData.related_customer_id}
                    onChange={(e) => setFormData({ ...formData, related_customer_id: e.target.value })}
                  >
                    <option value="">None</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Title & Status */}
              <div>
                <div className="flex items-start justify-between gap-3">
                  <h3 className={`text-lg font-medium ${task.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                    {task.title}
                  </h3>
                  <div className="flex items-center gap-2 shrink-0">
                    <TaskStatusBadge status={task.status} />
                    {task.priority !== 'normal' && (
                      <TaskPriorityBadge priority={task.priority} />
                    )}
                  </div>
                </div>
                
                {task.description && (
                  <p className="mt-2 text-gray-600">{task.description}</p>
                )}
              </div>

              {/* Details */}
              <div className="space-y-3 pt-4 border-t">
                {assignedUser && (
                  <div className="flex items-center gap-3 text-sm">
                    <User className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-600">Assigned to</span>
                    <span className="font-medium text-gray-900">{assignedUser.name}</span>
                  </div>
                )}

                {task.due_date && (
                  <div className="flex items-center gap-3 text-sm">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-600">Due</span>
                    <span className="font-medium text-gray-900">
                      {format(parseISO(task.due_date), 'MMMM d, yyyy')}
                      {task.due_time && ` at ${task.due_time}`}
                    </span>
                  </div>
                )}

                {relatedCustomer && (
                  <div className="flex items-center gap-3 text-sm">
                    <Building className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-600">Customer</span>
                    <span className="font-medium text-blue-600">{relatedCustomer.name}</span>
                  </div>
                )}

                {relatedJob && (
                  <div className="flex items-center gap-3 text-sm">
                    <Briefcase className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-600">Related Job</span>
                    <span className="font-medium text-gray-900">{relatedJob.job_type}</span>
                  </div>
                )}

                {task.completed_at && (
                  <div className="flex items-center gap-3 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-gray-600">Completed</span>
                    <span className="font-medium text-gray-900">
                      {format(parseISO(task.completed_at), 'MMMM d, yyyy')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between p-4 border-t bg-gray-50">
          <div>
            {!isEditing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setIsEditing(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </Button>
              </>
            ) : (
              <>
                {task.status !== 'completed' && (
                  <Button
                    onClick={handleComplete}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Mark Complete
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
