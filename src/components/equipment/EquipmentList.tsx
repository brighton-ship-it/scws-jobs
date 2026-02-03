'use client';

import { useState } from 'react';
import { format, differenceInDays, parseISO } from 'date-fns';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableEmpty, TableActions } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import {
  Wrench,
  Plus,
  Edit,
  Trash2,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Calendar,
  MapPin,
} from 'lucide-react';
import type { CustomerEquipment, Property } from '@/types/database';

interface EquipmentListProps {
  customerId: string;
  equipment: (CustomerEquipment & { property?: { id: string; address: string; city: string | null } })[];
  properties: Property[];
  onEquipmentChange: (equipment: CustomerEquipment[]) => void;
}

const equipmentTypes = [
  'Submersible Pump',
  'Jet Pump',
  'Motor',
  'Pressure Tank',
  'Pressure Switch',
  'Control Box',
  'Well Cap',
  'Pitless Adapter',
  'Check Valve',
  'Foot Valve',
  'Booster Pump',
  'Water Softener',
  'Filter System',
  'UV System',
  'Other',
];

function getWarrantyStatus(warrantyExpires: string | null): {
  status: 'expired' | 'expiring_soon' | 'valid' | 'none';
  daysLeft: number | null;
  variant: 'danger' | 'warning' | 'success' | 'default';
} {
  if (!warrantyExpires) {
    return { status: 'none', daysLeft: null, variant: 'default' };
  }

  const expiryDate = parseISO(warrantyExpires);
  const daysLeft = differenceInDays(expiryDate, new Date());

  if (daysLeft < 0) {
    return { status: 'expired', daysLeft, variant: 'danger' };
  } else if (daysLeft <= 30) {
    return { status: 'expiring_soon', daysLeft, variant: 'warning' };
  } else {
    return { status: 'valid', daysLeft, variant: 'success' };
  }
}

function WarrantyBadge({ warrantyExpires }: { warrantyExpires: string | null }) {
  const { status, daysLeft, variant } = getWarrantyStatus(warrantyExpires);

  if (status === 'none') {
    return <span className="text-gray-400 text-sm">No warranty</span>;
  }

  const Icon = status === 'expired' ? AlertCircle :
    status === 'expiring_soon' ? AlertTriangle : CheckCircle;

  return (
    <Badge variant={variant}>
      <Icon className="h-3 w-3 mr-1" />
      {status === 'expired' && 'Expired'}
      {status === 'expiring_soon' && `${daysLeft} days left`}
      {status === 'valid' && `${daysLeft} days left`}
    </Badge>
  );
}

export function EquipmentList({ customerId, equipment, properties, onEquipmentChange }: EquipmentListProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<CustomerEquipment | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    equipment_type: '',
    manufacturer: '',
    model: '',
    serial_number: '',
    install_date: '',
    warranty_expires: '',
    property_id: '',
    notes: '',
  });

  const resetForm = () => {
    setFormData({
      equipment_type: '',
      manufacturer: '',
      model: '',
      serial_number: '',
      install_date: '',
      warranty_expires: '',
      property_id: '',
      notes: '',
    });
    setEditing(null);
  };

  const openAddDialog = () => {
    resetForm();
    setShowDialog(true);
  };

  const openEditDialog = (item: CustomerEquipment) => {
    setEditing(item);
    setFormData({
      equipment_type: item.equipment_type,
      manufacturer: item.manufacturer || '',
      model: item.model || '',
      serial_number: item.serial_number || '',
      install_date: item.install_date || '',
      warranty_expires: item.warranty_expires || '',
      property_id: item.property_id || '',
      notes: item.notes || '',
    });
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!formData.equipment_type.trim()) return;

    setSaving(true);
    try {
      const url = editing
        ? `/api/customers/${customerId}/equipment/${editing.id}`
        : `/api/customers/${customerId}/equipment`;
      
      const response = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_type: formData.equipment_type,
          manufacturer: formData.manufacturer || null,
          model: formData.model || null,
          serial_number: formData.serial_number || null,
          install_date: formData.install_date || null,
          warranty_expires: formData.warranty_expires || null,
          property_id: formData.property_id || null,
          notes: formData.notes || null,
        }),
      });

      if (response.ok) {
        const { equipment: updated } = await response.json();
        if (editing) {
          onEquipmentChange(equipment.map(e => e.id === editing.id ? updated : e));
        } else {
          onEquipmentChange([...equipment, updated]);
        }
        setShowDialog(false);
        resetForm();
      }
    } catch (error) {
      console.error('Save error:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this equipment record?')) return;

    setDeleting(id);
    try {
      const response = await fetch(`/api/customers/${customerId}/equipment/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        onEquipmentChange(equipment.filter(e => e.id !== id));
      }
    } catch (error) {
      console.error('Delete error:', error);
    } finally {
      setDeleting(null);
    }
  };

  // Sort equipment: expiring soon first, then by type
  const sortedEquipment = [...equipment].sort((a, b) => {
    const statusA = getWarrantyStatus(a.warranty_expires);
    const statusB = getWarrantyStatus(b.warranty_expires);
    
    // Expired and expiring_soon come first
    const priorityMap = { expired: 0, expiring_soon: 1, valid: 2, none: 3 };
    const priorityDiff = priorityMap[statusA.status] - priorityMap[statusB.status];
    if (priorityDiff !== 0) return priorityDiff;
    
    return a.equipment_type.localeCompare(b.equipment_type);
  });

  // Count expiring warranties
  const expiringCount = equipment.filter(e => {
    const status = getWarrantyStatus(e.warranty_expires);
    return status.status === 'expired' || status.status === 'expiring_soon';
  }).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-gray-400" />
            Equipment ({equipment.length})
          </CardTitle>
          {expiringCount > 0 && (
            <Badge variant="warning">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {expiringCount} warranty alert{expiringCount > 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={openAddDialog}>
          <Plus className="h-4 w-4" />
          Add Equipment
        </Button>
      </CardHeader>
      
      {equipment.length === 0 ? (
        <CardContent>
          <div className="text-center py-8">
            <Wrench className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 mb-4">No equipment recorded</p>
            <Button variant="outline" onClick={openAddDialog}>
              <Plus className="h-4 w-4" />
              Add Equipment
            </Button>
          </div>
        </CardContent>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableCell header>Equipment</TableCell>
              <TableCell header>Manufacturer / Model</TableCell>
              <TableCell header>Serial #</TableCell>
              <TableCell header>Install Date</TableCell>
              <TableCell header>Warranty</TableCell>
              <TableCell header></TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedEquipment.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div>
                    <p className="font-medium text-gray-900">{item.equipment_type}</p>
                    {item.property && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="h-3 w-3" />
                        {item.property.address}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {item.manufacturer || item.model ? (
                    <div>
                      {item.manufacturer && <p className="text-gray-900">{item.manufacturer}</p>}
                      {item.model && <p className="text-sm text-gray-500">{item.model}</p>}
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {item.serial_number || <span className="text-gray-400">—</span>}
                </TableCell>
                <TableCell>
                  {item.install_date ? (
                    <div className="flex items-center gap-1 text-gray-600">
                      <Calendar className="h-3.5 w-3.5" />
                      {format(parseISO(item.install_date), 'MMM d, yyyy')}
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <WarrantyBadge warrantyExpires={item.warranty_expires} />
                </TableCell>
                <TableActions>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditDialog(item)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(item.id)}
                    loading={deleting === item.id}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableActions>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-white max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Equipment' : 'Add Equipment'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Equipment Type *
              </label>
              <Select
                value={formData.equipment_type}
                onChange={(e) => setFormData({ ...formData, equipment_type: e.target.value })}
              >
                <option value="">Select type...</option>
                {equipmentTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </Select>
            </div>

            {properties.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Property
                </label>
                <Select
                  value={formData.property_id}
                  onChange={(e) => setFormData({ ...formData, property_id: e.target.value })}
                >
                  <option value="">All properties</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.address}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Manufacturer
                </label>
                <Input
                  value={formData.manufacturer}
                  onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                  placeholder="e.g., Grundfos"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Model
                </label>
                <Input
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  placeholder="e.g., SQ 2-55"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Serial Number
              </label>
              <Input
                value={formData.serial_number}
                onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                placeholder="e.g., 12345ABC"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Install Date
                </label>
                <Input
                  type="date"
                  value={formData.install_date}
                  onChange={(e) => setFormData({ ...formData, install_date: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Warranty Expires
                </label>
                <Input
                  type="date"
                  value={formData.warranty_expires}
                  onChange={(e) => setFormData({ ...formData, warranty_expires: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                rows={2}
                placeholder="Any additional notes..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saving} disabled={!formData.equipment_type.trim()}>
              {editing ? 'Save Changes' : 'Add Equipment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
