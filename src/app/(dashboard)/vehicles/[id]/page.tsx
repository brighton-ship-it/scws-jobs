'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, 
  Edit, 
  Trash2, 
  Truck, 
  Calendar,
  Shield,
  User as UserIcon,
  Save,
  X,
  AlertTriangle,
  CheckCircle,
  Clock
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { VehicleWithUser, User, VehicleReminder } from '@/types/database';
import { format } from 'date-fns';

const vehicleStatuses = ['active', 'inactive', 'maintenance', 'sold'];
const commonMakes = [
  'Ford', 'Chevrolet', 'GMC', 'Dodge', 'Ram', 'Toyota', 'Nissan', 'Honda',
  'Isuzu', 'Freightliner', 'International', 'Peterbilt', 'Kenworth', 'Other'
];

export default function VehicleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  
  const [vehicle, setVehicle] = useState<VehicleWithUser | null>(null);
  const [reminders, setReminders] = useState<VehicleReminder[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [editForm, setEditForm] = useState<Partial<VehicleWithUser>>({});

  const fetchVehicle = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/vehicles/${id}`);
      if (res.ok) {
        const data = await res.json();
        setVehicle(data.vehicle);
        setReminders(data.reminders || []);
        setEditForm(data.vehicle);
      } else if (res.status === 404) {
        router.push('/vehicles');
      }
    } catch (error) {
      console.error('Failed to fetch vehicle:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  };

  useEffect(() => {
    fetchVehicle();
    fetchUsers();
  }, [id]);

  const handleSave = async () => {
    if (!vehicle) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/vehicles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editForm,
          year: editForm.year ? parseInt(String(editForm.year)) : null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setVehicle({ ...data.vehicle, registration_status: vehicle.registration_status, days_until_due: vehicle.days_until_due });
        setEditing(false);
        fetchVehicle(); // Refresh to get updated computed fields
      }
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this vehicle? This action cannot be undone.')) return;
    try {
      const res = await fetch(`/api/vehicles/${id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/vehicles');
      }
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const getStatusIcon = () => {
    switch (vehicle?.registration_status) {
      case 'expired':
        return <AlertTriangle className="h-8 w-8 text-red-500" />;
      case 'due_soon':
        return <Clock className="h-8 w-8 text-yellow-500" />;
      case 'upcoming':
        return <Calendar className="h-8 w-8 text-blue-500" />;
      default:
        return <CheckCircle className="h-8 w-8 text-green-500" />;
    }
  };

  const getStatusText = () => {
    switch (vehicle?.registration_status) {
      case 'expired':
        return { text: 'Registration Expired', color: 'text-red-600', bg: 'bg-red-50 border-red-200' };
      case 'due_soon':
        return { text: `Due in ${vehicle.days_until_due} days`, color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200' };
      case 'upcoming':
        return { text: `Due in ${vehicle.days_until_due} days`, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' };
      default:
        return { text: 'Registration Current', color: 'text-green-600', bg: 'bg-green-50 border-green-200' };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="text-center py-12">
        <Truck className="h-12 w-12 mx-auto text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900">Vehicle not found</h2>
        <Link href="/vehicles" className="text-green-600 hover:underline mt-4 inline-block">
          Back to Vehicles
        </Link>
      </div>
    );
  }

  const statusInfo = getStatusText();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/vehicles" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Truck className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{vehicle.name}</h1>
              <p className="text-gray-500">
                {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle Details'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button variant="outline" onClick={() => { setEditing(false); setEditForm(vehicle); }}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Edit className="h-4 w-4" />
                Edit
              </Button>
              <Button variant="outline" onClick={handleDelete} className="text-red-600 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Vehicle Details */}
          <Card>
            <CardHeader>
              <CardTitle>Vehicle Information</CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Vehicle Name</Label>
                      <Input
                        value={editForm.name || ''}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Status</Label>
                      <Select 
                        value={editForm.status} 
                        onValueChange={(v) => setEditForm({ ...editForm, status: v as any })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {vehicleStatuses.map(status => (
                            <SelectItem key={status} value={status}>
                              {status.charAt(0).toUpperCase() + status.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>License Plate</Label>
                      <Input
                        value={editForm.license_plate || ''}
                        onChange={(e) => setEditForm({ ...editForm, license_plate: e.target.value.toUpperCase() })}
                      />
                    </div>
                    <div>
                      <Label>VIN</Label>
                      <Input
                        value={editForm.vin || ''}
                        onChange={(e) => setEditForm({ ...editForm, vin: e.target.value.toUpperCase() })}
                        maxLength={17}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label>Year</Label>
                      <Input
                        type="number"
                        value={editForm.year || ''}
                        onChange={(e) => setEditForm({ ...editForm, year: parseInt(e.target.value) || null })}
                      />
                    </div>
                    <div>
                      <Label>Make</Label>
                      <Select 
                        value={editForm.make || ''} 
                        onValueChange={(v) => setEditForm({ ...editForm, make: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select make" />
                        </SelectTrigger>
                        <SelectContent>
                          {commonMakes.map(make => (
                            <SelectItem key={make} value={make}>{make}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Model</Label>
                      <Input
                        value={editForm.model || ''}
                        onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Registration Due Date</Label>
                      <Input
                        type="date"
                        value={editForm.registration_due_date || ''}
                        onChange={(e) => setEditForm({ ...editForm, registration_due_date: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Insurance Expiry Date</Label>
                      <Input
                        type="date"
                        value={editForm.insurance_expiry_date || ''}
                        onChange={(e) => setEditForm({ ...editForm, insurance_expiry_date: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Assigned To</Label>
                    <Select 
                      value={editForm.assigned_user_id || ''} 
                      onValueChange={(v) => setEditForm({ ...editForm, assigned_user_id: v || null })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Unassigned</SelectItem>
                        {users.map(user => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name} ({user.role})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea
                      value={editForm.notes || ''}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      rows={3}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">License Plate</p>
                      <p className="font-mono font-medium text-lg">{vehicle.license_plate || '—'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">VIN</p>
                      <p className="font-mono text-sm">{vehicle.vin || '—'}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Year</p>
                      <p className="font-medium">{vehicle.year || '—'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Make</p>
                      <p className="font-medium">{vehicle.make || '—'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Model</p>
                      <p className="font-medium">{vehicle.model || '—'}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Insurance Expiry</p>
                      <p className="font-medium">
                        {vehicle.insurance_expiry_date 
                          ? format(new Date(vehicle.insurance_expiry_date), 'MMM d, yyyy')
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Vehicle Status</p>
                      <Badge variant={vehicle.status === 'active' ? 'success' : 'default'}>
                        {vehicle.status.charAt(0).toUpperCase() + vehicle.status.slice(1)}
                      </Badge>
                    </div>
                  </div>
                  {vehicle.assigned_user && (
                    <div>
                      <p className="text-sm text-gray-500">Assigned To</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center text-sm font-semibold text-green-700">
                          {vehicle.assigned_user.name?.charAt(0) || 'U'}
                        </div>
                        <div>
                          <p className="font-medium">{vehicle.assigned_user.name}</p>
                          <p className="text-xs text-gray-500">{vehicle.assigned_user.email}</p>
                        </div>
                      </div>
                    </div>
                  )}
                  {vehicle.notes && (
                    <div>
                      <p className="text-sm text-gray-500">Notes</p>
                      <p className="text-gray-700 whitespace-pre-wrap">{vehicle.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reminder History */}
          {reminders.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Reminder History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {reminders.map((reminder) => (
                    <div 
                      key={reminder.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <p className="font-medium text-gray-900 capitalize">
                          {reminder.reminder_type} Reminder
                        </p>
                        <p className="text-sm text-gray-500">
                          {reminder.days_before} days before • Sent {format(new Date(reminder.sent_at), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Registration Status Card */}
          <Card className={`border ${statusInfo.bg}`}>
            <CardContent className="py-6 text-center">
              <div className="flex justify-center mb-3">
                {getStatusIcon()}
              </div>
              <p className={`text-lg font-bold ${statusInfo.color}`}>
                {statusInfo.text}
              </p>
              {vehicle.registration_due_date && (
                <p className="text-sm text-gray-500 mt-2">
                  Due: {format(new Date(vehicle.registration_due_date), 'MMMM d, yyyy')}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Quick Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Quick Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Registration Due</p>
                  <p className="text-sm font-medium">
                    {vehicle.registration_due_date 
                      ? format(new Date(vehicle.registration_due_date), 'MMM d, yyyy')
                      : 'Not set'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Shield className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Insurance Expiry</p>
                  <p className="text-sm font-medium">
                    {vehicle.insurance_expiry_date 
                      ? format(new Date(vehicle.insurance_expiry_date), 'MMM d, yyyy')
                      : 'Not set'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <UserIcon className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Assigned To</p>
                  <p className="text-sm font-medium">
                    {vehicle.assigned_user?.name || 'Unassigned'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Timestamps */}
          <Card>
            <CardContent className="py-4 text-xs text-gray-500 space-y-1">
              <p>Created: {format(new Date(vehicle.created_at), 'MMM d, yyyy h:mm a')}</p>
              <p>Updated: {format(new Date(vehicle.updated_at), 'MMM d, yyyy h:mm a')}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
