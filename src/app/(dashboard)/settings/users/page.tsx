'use client';


import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Button } from '@/components/forms/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/feedback/Modal';
import { Input } from '@/components/forms/Input';
import { Select } from '@/components/forms/Select';
import { mockUsers } from '@/lib/mock-data';
import { 
  Plus, 
  Mail, 
  Phone, 
  MoreVertical,
  Edit,
  Trash2,
  UserPlus,
} from 'lucide-react';

const roleColors = {
  admin: 'bg-purple-100 text-purple-700',
  office: 'bg-blue-100 text-blue-700',
  field: 'bg-green-100 text-green-700',
};

const roleLabels = {
  admin: 'Admin',
  office: 'Office',
  field: 'Field Tech',
};

export default function UsersSettingsPage() {
  const [users] = useState(mockUsers);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    name: '',
    role: 'field',
  });

  const handleInvite = () => {
    alert(`Invitation sent to ${inviteForm.email}`);
    setShowInviteModal(false);
    setInviteForm({ email: '', name: '', role: 'field' });
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Settings', href: '/settings' },
          { label: 'Team' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Team Management</h2>
          <p className="text-gray-600">Manage users and their permissions</p>
        </div>
        <Button onClick={() => setShowInviteModal(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Invite User
        </Button>
      </div>

      {/* Users List */}
      <Card>
        <CardHeader>
          <CardTitle>Team Members ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-gray-100">
            {users.map((user) => (
              <div key={user.id} className="flex items-center gap-4 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 font-medium text-gray-600">
                  {user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900">{user.name}</p>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {user.email}
                    </span>
                    {user.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {user.phone}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${roleColors[user.role]}`}>
                  {roleLabels[user.role]}
                </span>
                <button className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Role Descriptions */}
      <Card>
        <CardHeader>
          <CardTitle>Role Permissions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="rounded-lg bg-purple-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${roleColors.admin}`}>
                  Admin
                </span>
              </div>
              <p className="text-sm text-gray-600">
                Full access to all features including settings, reports, and user management.
              </p>
            </div>
            <div className="rounded-lg bg-blue-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${roleColors.office}`}>
                  Office
                </span>
              </div>
              <p className="text-sm text-gray-600">
                Can manage customers, jobs, invoices, and scheduling. Cannot access billing settings.
              </p>
            </div>
            <div className="rounded-lg bg-green-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${roleColors.field}`}>
                  Field Tech
                </span>
              </div>
              <p className="text-sm text-gray-600">
                Can view assigned jobs, update job status, and add notes/photos. Limited dashboard access.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Invite Modal */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="Invite Team Member"
      >
        <div className="space-y-4">
          <Input
            label="Name"
            value={inviteForm.name}
            onChange={(e) => setInviteForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="John Doe"
          />
          <Input
            label="Email"
            type="email"
            value={inviteForm.email}
            onChange={(e) => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
            placeholder="john@example.com"
          />
          <Select
            label="Role"
            value={inviteForm.role}
            onChange={(e) => setInviteForm(prev => ({ ...prev, role: e.target.value }))}
            options={[
              { value: 'field', label: 'Field Tech' },
              { value: 'office', label: 'Office Staff' },
              { value: 'admin', label: 'Admin' },
            ]}
          />
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowInviteModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleInvite}>
              Send Invitation
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
