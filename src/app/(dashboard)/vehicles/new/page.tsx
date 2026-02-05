'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Truck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import type { User } from '@/types/database';

const vehicleStatuses = ['active', 'inactive', 'maintenance', 'sold'];

const commonMakes = [
  'Ford', 'Chevrolet', 'GMC', 'Dodge', 'Ram', 'Toyota', 'Nissan', 'Honda',
  'Isuzu', 'Freightliner', 'International', 'Peterbilt', 'Kenworth', 'Other'
];

export default function NewVehiclePage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  
  const [form, setForm] = useState({
    name: '',
    license_plate: '',
    vin: '',
    year: '',
    make: '',
    model: '',
    registration_due_date: '',
    insurance_expiry_date: '',
    assigned_user_id: '',
    status: 'active',
    notes: '',
  });

  useEffect(() => {
    // Fetch users for assignment dropdown
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
    fetchUsers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) {
      setError('Vehicle name is required');
      return;
    }
    
    setSaving(true);
    setError('');
    
    try {
      const res = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          year: form.year ? parseInt(form.year) : null,
          assigned_user_id: form.assigned_user_id || null,
        }),
      });
      
      if (res.ok) {
        const data = await res.json();
        router.push(`/vehicles/${data.vehicle.id}`);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create vehicle');
      }
    } catch (err) {
      console.error('Failed to create vehicle:', err);
      setError('Failed to create vehicle');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/vehicles" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="h-5 w-5 text-gray-600" />
        </Link>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Truck className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Add Vehicle</h1>
            <p className="text-gray-500">Add a new vehicle to your fleet</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Vehicle Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            )}
            
            {/* Name and Status */}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <Label htmlFor="name">Vehicle Name *</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., White F-350"
                  required
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
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

            {/* License and VIN */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="license_plate">License Plate</Label>
                <Input
                  id="license_plate"
                  value={form.license_plate}
                  onChange={(e) => setForm({ ...form, license_plate: e.target.value.toUpperCase() })}
                  placeholder="e.g., 8ABC123"
                />
              </div>
              <div>
                <Label htmlFor="vin">VIN</Label>
                <Input
                  id="vin"
                  value={form.vin}
                  onChange={(e) => setForm({ ...form, vin: e.target.value.toUpperCase() })}
                  placeholder="17-character VIN"
                  maxLength={17}
                />
              </div>
            </div>

            {/* Year, Make, Model */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="year">Year</Label>
                <Input
                  id="year"
                  type="number"
                  min="1900"
                  max="2099"
                  value={form.year}
                  onChange={(e) => setForm({ ...form, year: e.target.value })}
                  placeholder="2024"
                />
              </div>
              <div>
                <Label>Make</Label>
                <Select value={form.make} onValueChange={(v) => setForm({ ...form, make: v })}>
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
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="e.g., F-350"
                />
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="registration_due_date">Registration Due Date</Label>
                <Input
                  id="registration_due_date"
                  type="date"
                  value={form.registration_due_date}
                  onChange={(e) => setForm({ ...form, registration_due_date: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="insurance_expiry_date">Insurance Expiry Date</Label>
                <Input
                  id="insurance_expiry_date"
                  type="date"
                  value={form.insurance_expiry_date}
                  onChange={(e) => setForm({ ...form, insurance_expiry_date: e.target.value })}
                />
              </div>
            </div>

            {/* Assigned User */}
            <div>
              <Label>Assigned To</Label>
              <Select 
                value={form.assigned_user_id} 
                onValueChange={(v) => setForm({ ...form, assigned_user_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select user (optional)" />
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

            {/* Notes */}
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Any additional notes about this vehicle..."
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Link href="/vehicles">
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
              <Button type="submit" disabled={saving}>
                <Save className="h-4 w-4" />
                {saving ? 'Saving...' : 'Add Vehicle'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
