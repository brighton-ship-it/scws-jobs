'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { roleInfo } from '@/lib/permissions';
import type { UserRole } from '@/types/database';
import { 
  Plus, 
  Mail, 
  Phone, 
  MoreVertical,
  Edit,
  Trash2,
  UserPlus,
  Clock,
  DollarSign,
  Shield,
  Calendar,
  ChevronRight,
  ChevronLeft,
  X,
  Upload,
  User,
  Users,
  Building2,
  Bell,
  CreditCard,
  Puzzle,
  Loader2
} from 'lucide-react';

// Mock team data matching Jobber structure
const mockTeamMembers = [
  { 
    id: '1', 
    name: 'Brighton Scala', 
    email: 'brighton@scwellservice.com', 
    phone: '(760) 440-8520',
    role: 'owner',
    roleLabel: 'Account Owner',
    laborCost: 0,
    lastLogin: '2026-01-31',
    avatar: null,
    schedule: {
      sunday: null,
      monday: { start: '7:00 AM', end: '5:00 PM' },
      tuesday: { start: '7:00 AM', end: '5:00 PM' },
      wednesday: { start: '7:00 AM', end: '5:00 PM' },
      thursday: { start: '7:00 AM', end: '5:00 PM' },
      friday: { start: '7:00 AM', end: '5:00 PM' },
      saturday: null
    }
  },
  { 
    id: '2', 
    name: 'Brian Schroeder', 
    email: 'bschroeder@scwellservice.com', 
    phone: '(760) 555-0102',
    role: 'admin',
    roleLabel: 'Admin',
    laborCost: 35,
    lastLogin: '2026-01-30',
    avatar: null,
    schedule: {
      sunday: null,
      monday: { start: '7:00 AM', end: '5:00 PM' },
      tuesday: { start: '7:00 AM', end: '5:00 PM' },
      wednesday: { start: '7:00 AM', end: '5:00 PM' },
      thursday: { start: '7:00 AM', end: '5:00 PM' },
      friday: { start: '7:00 AM', end: '5:00 PM' },
      saturday: null
    }
  },
  { 
    id: '3', 
    name: 'Roger Scala', 
    email: 'roger@scwellservice.com', 
    phone: '(760) 555-0103',
    role: 'manager',
    roleLabel: 'Manager',
    laborCost: 40,
    lastLogin: '2026-01-30',
    avatar: null,
    schedule: {
      sunday: null,
      monday: { start: '6:00 AM', end: '4:00 PM' },
      tuesday: { start: '6:00 AM', end: '4:00 PM' },
      wednesday: { start: '6:00 AM', end: '4:00 PM' },
      thursday: { start: '6:00 AM', end: '4:00 PM' },
      friday: { start: '6:00 AM', end: '4:00 PM' },
      saturday: null
    }
  },
  { 
    id: '4', 
    name: 'Travis Sego', 
    email: 'travis@scwellservice.com', 
    phone: '(760) 555-0104',
    role: 'worker',
    roleLabel: 'Field Tech',
    laborCost: 28,
    lastLogin: '2026-01-30',
    avatar: null,
    schedule: {
      sunday: null,
      monday: { start: '7:00 AM', end: '5:00 PM' },
      tuesday: { start: '7:00 AM', end: '5:00 PM' },
      wednesday: { start: '7:00 AM', end: '5:00 PM' },
      thursday: { start: '7:00 AM', end: '5:00 PM' },
      friday: { start: '7:00 AM', end: '5:00 PM' },
      saturday: null
    }
  },
  { 
    id: '5', 
    name: 'Dakota Cole', 
    email: 'dakota@scwellservice.com', 
    phone: '(760) 555-0105',
    role: 'worker_limited',
    roleLabel: 'Worker (Limited)',
    laborCost: 25,
    lastLogin: '2026-01-29',
    avatar: null,
    schedule: {
      sunday: null,
      monday: { start: '8:00 AM', end: '4:00 PM' },
      tuesday: { start: '8:00 AM', end: '4:00 PM' },
      wednesday: { start: '8:00 AM', end: '4:00 PM' },
      thursday: { start: '8:00 AM', end: '4:00 PM' },
      friday: { start: '8:00 AM', end: '4:00 PM' },
      saturday: null
    }
  },
];

const roleColors: Record<string, string> = {
  owner: 'bg-amber-100 text-amber-800',
  admin: 'bg-purple-100 text-purple-700',
  office: 'bg-blue-100 text-blue-700',
  tech: 'bg-green-100 text-green-700',
  field: 'bg-green-100 text-green-700',
  manager: 'bg-blue-100 text-blue-700',
  dispatcher: 'bg-cyan-100 text-cyan-700',
  worker: 'bg-green-100 text-green-700',
  worker_limited: 'bg-gray-100 text-gray-700',
};

// New role-based permission presets
const rolePresets: { value: UserRole; label: string; description: string }[] = [
  { 
    value: 'tech', 
    label: 'Technician', 
    description: 'View assigned jobs, update job status, add notes and photos. Limited access.'
  },
  { 
    value: 'office', 
    label: 'Office Staff', 
    description: 'Manage customers, jobs, invoices, reports. No access to settings.'
  },
  { 
    value: 'admin', 
    label: 'Administrator', 
    description: 'Full access to everything including settings and user management.'
  },
];

// Legacy presets for backward compatibility
const permissionPresets = [
  { 
    value: 'worker_limited', 
    label: 'Worker (Limited access)', 
    description: 'View their schedule, mark work complete, and track their time.'
  },
  { 
    value: 'worker', 
    label: 'Worker', 
    description: 'View all clients, quotes, and jobs, including pricing details.'
  },
  { 
    value: 'dispatcher', 
    label: 'Dispatcher', 
    description: 'Edit job, team and client details. Recommended for team leads.'
  },
  { 
    value: 'manager', 
    label: 'Manager', 
    description: 'Manage all areas including billing — excludes reports and payroll.'
  },
  { 
    value: 'admin', 
    label: 'Admin', 
    description: 'Full access to everything including billing, reports, and user management.'
  },
];

export default function UsersSettingsPage() {
  const [teamMembers, setTeamMembers] = useState(mockTeamMembers);
  const [showNewUserModal, setShowNewUserModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<typeof mockTeamMembers[0] | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'tech' as UserRole,
    laborCost: 0,
  });

  const activeCount = teamMembers.length;
  const maxUsers = 10; // Simulated plan limit

  const handleEditUser = (user: typeof mockTeamMembers[0]) => {
    setSelectedUser(user);
    setShowEditModal(true);
    setActiveDropdown(null);
  };

  const handleDeleteUser = (userId: string) => {
    if (confirm('Are you sure you want to remove this team member?')) {
      setTeamMembers(prev => prev.filter(u => u.id !== userId));
    }
    setActiveDropdown(null);
  };

  const handleCreateUser = () => {
    const roleLabel = rolePresets.find(p => p.value === newUserForm.role)?.label || 'Technician';
    const newUser = {
      id: Date.now().toString(),
      name: newUserForm.name,
      email: newUserForm.email,
      phone: newUserForm.phone,
      role: newUserForm.role,
      roleLabel,
      laborCost: newUserForm.laborCost,
      lastLogin: null as any,
      avatar: null,
      schedule: {
        sunday: null,
        monday: { start: '7:00 AM', end: '5:00 PM' },
        tuesday: { start: '7:00 AM', end: '5:00 PM' },
        wednesday: { start: '7:00 AM', end: '5:00 PM' },
        thursday: { start: '7:00 AM', end: '5:00 PM' },
        friday: { start: '7:00 AM', end: '5:00 PM' },
        saturday: null
      }
    };
    setTeamMembers(prev => [...prev, newUser]);
    setShowNewUserModal(false);
    setNewUserForm({ name: '', email: '', phone: '', role: 'tech', laborCost: 0 });
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="space-y-6">
      {/* Back to Settings + Quick Nav */}
      <div className="flex items-center gap-4">
        <Link 
          href="/settings" 
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          <ChevronLeft className="h-4 w-4" />
          Settings
        </Link>
      </div>

      {/* Settings Quick Nav (Mobile) */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
        <Link href="/settings/company" className="flex-shrink-0 px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200">
          <Building2 className="h-4 w-4 inline mr-1" />
          Company
        </Link>
        <span className="flex-shrink-0 px-3 py-1.5 text-sm bg-green-100 text-green-700 rounded-full font-medium">
          <Users className="h-4 w-4 inline mr-1" />
          Team
        </span>
        <Link href="/settings/notifications" className="flex-shrink-0 px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200">
          <Bell className="h-4 w-4 inline mr-1" />
          Notifications
        </Link>
        <Link href="/settings/billing" className="flex-shrink-0 px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200">
          <CreditCard className="h-4 w-4 inline mr-1" />
          Billing
        </Link>
        <Link href="/settings/integrations" className="flex-shrink-0 px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200">
          <Puzzle className="h-4 w-4 inline mr-1" />
          Integrations
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Manage Team</h1>
          <p className="text-gray-500 text-sm sm:text-base">Add or manage team members that need to log in.</p>
        </div>
        <button
          onClick={() => setShowNewUserModal(true)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          Add User
        </button>
      </div>

      {/* Active Users Card */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-gray-900">ACTIVE USERS</h2>
            <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {activeCount} of {maxUsers}
            </span>
          </div>
        </div>
        
        {activeCount >= maxUsers && (
          <div className="px-6 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
            <span className="text-amber-600 text-sm">
              You've reached your active user limit. Each additional user will cost <strong>$29 USD/mo</strong>.
            </span>
          </div>
        )}

        {/* Team Members List */}
        <div className="divide-y divide-gray-100">
          {teamMembers.map((member) => (
            <div key={member.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className={`flex h-10 w-10 items-center justify-center rounded-full font-medium text-sm ${
                  member.role === 'owner' ? 'bg-amber-200 text-amber-800' :
                  member.role === 'admin' ? 'bg-purple-200 text-purple-800' :
                  member.role === 'manager' ? 'bg-blue-200 text-blue-800' :
                  'bg-green-200 text-green-800'
                }`}>
                  {getInitials(member.name)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button 
                      onClick={() => handleEditUser(member)}
                      className="font-medium text-green-600 hover:text-green-700 hover:underline"
                    >
                      {member.name}
                    </button>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[member.role]}`}>
                      {member.roleLabel}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 sm:space-y-0 sm:grid sm:grid-cols-2 sm:gap-x-8 text-sm">
                    <div>
                      <span className="text-gray-500">Email</span>
                      <p className="text-gray-900 truncate">{member.email}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Last Login</span>
                      <p className="text-gray-900">{formatDate(member.lastLogin)}</p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                {member.role !== 'owner' && (
                  <div className="relative">
                    <button 
                      onClick={() => setActiveDropdown(activeDropdown === member.id ? null : member.id)}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                    
                    {activeDropdown === member.id && (
                      <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
                        <button
                          onClick={() => handleEditUser(member)}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                        >
                          <Edit className="h-4 w-4" />
                          Edit User
                        </button>
                        <button
                          onClick={() => handleDeleteUser(member.id)}
                          className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                          <Trash2 className="h-4 w-4" />
                          Remove User
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Role Reference */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Role Permissions</h3>
        <div className="grid gap-3">
          {rolePresets.map((preset) => (
            <div key={preset.value} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
              <div className={`px-2 py-1 rounded text-xs font-medium ${roleColors[preset.value] || 'bg-gray-100 text-gray-700'}`}>
                {preset.label}
              </div>
              <p className="text-sm text-gray-600">{preset.description}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> Technicians can only see jobs assigned to them, update job status, and add notes/photos. 
            Office staff has full access except settings. Admins have complete access.
          </p>
        </div>
      </div>

      {/* New User Modal */}
      {showNewUserModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-bold">New User</h2>
              <button 
                onClick={() => setShowNewUserModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Personal Info */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-4">Personal info</h3>
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
                    <User className="h-8 w-8 text-gray-400" />
                  </div>
                  <button className="px-4 py-2 border border-green-600 text-green-600 rounded-lg hover:bg-green-50 transition-colors text-sm">
                    Upload Image
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full name *</label>
                    <input
                      type="text"
                      value={newUserForm.name}
                      onChange={(e) => setNewUserForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder="John Doe"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email address *</label>
                    <input
                      type="email"
                      value={newUserForm.email}
                      onChange={(e) => setNewUserForm(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder="john@scwellservice.com"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Mobile phone</label>
                    <input
                      type="tel"
                      value={newUserForm.phone}
                      onChange={(e) => setNewUserForm(prev => ({ ...prev, phone: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder="(760) 555-0100"
                    />
                  </div>
                </div>
              </div>

              {/* Labor Cost */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-4">Labor cost</h3>
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">$</span>
                  <input
                    type="number"
                    value={newUserForm.laborCost}
                    onChange={(e) => setNewUserForm(prev => ({ ...prev, laborCost: parseFloat(e.target.value) || 0 }))}
                    className="w-24 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    min="0"
                    step="0.01"
                  />
                  <span className="text-gray-600">per hour</span>
                </div>
              </div>

              {/* Role Selection */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-4">Role & Permissions</h3>
                <p className="text-sm text-gray-600 mb-3">Select the user's role to determine their access level:</p>
                <div className="space-y-2">
                  {rolePresets.map((preset) => (
                    <label 
                      key={preset.value}
                      className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                        newUserForm.role === preset.value 
                          ? 'border-green-500 bg-green-50' 
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={preset.value}
                        checked={newUserForm.role === preset.value}
                        onChange={(e) => setNewUserForm(prev => ({ ...prev, role: e.target.value as UserRole }))}
                        className="mt-1 h-4 w-4 text-green-600 border-gray-300 focus:ring-green-500"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{preset.label}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${roleColors[preset.value]}`}>
                            {preset.value}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 mt-0.5">{preset.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button 
                onClick={() => setShowNewUserModal(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateUser}
                disabled={!newUserForm.name || !newUserForm.email}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-bold">{selectedUser.name}</h2>
              <button 
                onClick={() => setShowEditModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Personal Info */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-4">Personal info</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-500">Email</label>
                    <p className="font-medium">{selectedUser.email}</p>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500">Phone</label>
                    <p className="font-medium">{selectedUser.phone || 'Not set'}</p>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500">Role</label>
                    <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[selectedUser.role]}`}>
                      {selectedUser.roleLabel}
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500">Labor Cost</label>
                    <p className="font-medium">${selectedUser.laborCost.toFixed(2)}/hr</p>
                  </div>
                </div>
              </div>

              {/* Schedule */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">Working hours</h3>
                  <button className="text-sm text-green-600 hover:text-green-700">Edit</button>
                </div>
                <div className="space-y-2 text-sm">
                  {Object.entries(selectedUser.schedule).map(([day, hours]) => (
                    <div key={day} className="flex justify-between">
                      <span className="text-gray-600 capitalize">{day}</span>
                      <span className="text-gray-900">
                        {hours ? `${hours.start} – ${hours.end}` : 'Unavailable'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Permissions Note */}
              {selectedUser.role === 'owner' && (
                <div className="bg-amber-50 rounded-lg p-4 text-sm text-amber-800">
                  Account owners are administrators with full permissions. Adjust permissions by transferring account ownership to another administrator.
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button 
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Close
              </button>
              <button 
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close dropdown */}
      {activeDropdown && (
        <div 
          className="fixed inset-0 z-0" 
          onClick={() => setActiveDropdown(null)}
        />
      )}
    </div>
  );
}
