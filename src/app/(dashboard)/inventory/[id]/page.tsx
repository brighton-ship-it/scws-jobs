'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, 
  Edit, 
  Trash2, 
  Package, 
  ArrowDown, 
  ArrowUp, 
  History,
  AlertTriangle,
  Save,
  X
} from 'lucide-react';
import { toast } from 'sonner';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { InventoryItem, StockAdjustment, JobPart } from '@/types/database';
import { format } from 'date-fns';

const categories = ['Pumps', 'Motors', 'Tanks', 'Fittings', 'Wire', 'Controls', 'Misc'];

export default function InventoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [adjustments, setAdjustments] = useState<(StockAdjustment & { jobs?: { id: string; job_type: string; job_number?: string } })[]>([]);
  const [jobParts, setJobParts] = useState<(JobPart & { jobs?: { id: string; job_type: string; job_number?: string } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Edit form state
  const [editForm, setEditForm] = useState<Partial<InventoryItem>>({});
  
  // Adjustment modal
  const [adjustmentModal, setAdjustmentModal] = useState<{ open: boolean; type: 'add' | 'remove' }>({ open: false, type: 'add' });
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('manual_adjustment');
  const [adjustmentNotes, setAdjustmentNotes] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const fetchItem = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/inventory/${id}`);
      if (res.ok) {
        const data = await res.json();
        setItem(data.item);
        setAdjustments(data.adjustments || []);
        setJobParts(data.jobParts || []);
        setEditForm(data.item);
      } else if (res.status === 404) {
        router.push('/inventory');
      }
    } catch (error) {
      console.error('Failed to fetch item:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItem();
  }, [id]);

  const handleSave = async () => {
    if (!item) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/inventory/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        const data = await res.json();
        setItem(data.item);
        setEditing(false);
      }
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    try {
      const res = await fetch(`/api/inventory/${id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/inventory');
      }
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const handleAdjustment = async () => {
    if (!item || !adjustmentQuantity) return;
    setAdjusting(true);
    try {
      const quantity = parseInt(adjustmentQuantity);
      const quantityChange = adjustmentModal.type === 'add' ? quantity : -quantity;
      
      const res = await fetch(`/api/inventory/${id}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity_change: quantityChange,
          reason: adjustmentReason,
          notes: adjustmentNotes || null,
        }),
      });
      
      if (res.ok) {
        setAdjustmentModal({ open: false, type: 'add' });
        setAdjustmentQuantity('');
        setAdjustmentNotes('');
        fetchItem();
        toast.success('Stock adjusted successfully');
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to adjust stock');
      }
    } catch {
      toast.error('Failed to adjust stock');
    } finally {
      setAdjusting(false);
    }
  };

  const getReasonLabel = (reason: string) => {
    const labels: Record<string, string> = {
      purchase: 'Purchase',
      job_usage: 'Job Usage',
      manual_adjustment: 'Manual Adjustment',
      return: 'Return',
      damaged: 'Damaged/Lost',
      inventory_count: 'Inventory Count',
    };
    return labels[reason] || reason;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="text-center py-12">
        <Package className="h-12 w-12 mx-auto text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900">Item not found</h2>
        <Link href="/inventory" className="text-green-600 hover:underline mt-4 inline-block">
          Back to Inventory
        </Link>
      </div>
    );
  }

  const isLowStock = item.quantity <= item.reorder_level;
  const isOutOfStock = item.quantity === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/inventory" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900">{item.name}</h1>
              {isOutOfStock && (
                <Badge variant="destructive">Out of Stock</Badge>
              )}
              {isLowStock && !isOutOfStock && (
                <Badge variant="warning">Low Stock</Badge>
              )}
            </div>
            <p className="text-gray-500">{item.sku || 'No SKU'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            onClick={() => setAdjustmentModal({ open: true, type: 'add' })}
          >
            <ArrowDown className="h-4 w-4" />
            Add Stock
          </Button>
          <Button 
            variant="outline" 
            onClick={() => setAdjustmentModal({ open: true, type: 'remove' })}
          >
            <ArrowUp className="h-4 w-4" />
            Remove Stock
          </Button>
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)}>
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
          {/* Item Details */}
          <Card>
            <CardHeader>
              <CardTitle>Item Details</CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Name</Label>
                      <Input
                        value={editForm.name || ''}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>SKU</Label>
                      <Input
                        value={editForm.sku || ''}
                        onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Category</Label>
                      <Select 
                        value={editForm.category} 
                        onValueChange={(v) => setEditForm({ ...editForm, category: v as InventoryItem['category'] })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map(cat => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Location</Label>
                      <Input
                        value={editForm.location || ''}
                        onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Unit Cost</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={editForm.unit_cost || ''}
                        onChange={(e) => setEditForm({ ...editForm, unit_cost: parseFloat(e.target.value) })}
                      />
                    </div>
                    <div>
                      <Label>Reorder Level</Label>
                      <Input
                        type="number"
                        value={editForm.reorder_level || ''}
                        onChange={(e) => setEditForm({ ...editForm, reorder_level: parseInt(e.target.value) })}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Vendor</Label>
                    <Input
                      value={editForm.vendor || ''}
                      onChange={(e) => setEditForm({ ...editForm, vendor: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={editForm.description || ''}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Category</p>
                      <Badge variant="default">{item.category}</Badge>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Location</p>
                      <p className="font-medium">{item.location || '—'}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Unit Cost</p>
                      <p className="font-medium">${Number(item.unit_cost).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Reorder Level</p>
                      <p className="font-medium">{item.reorder_level}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Vendor</p>
                    <p className="font-medium">{item.vendor || '—'}</p>
                  </div>
                  {item.description && (
                    <div>
                      <p className="text-sm text-gray-500">Description</p>
                      <p className="font-medium">{item.description}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stock History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-gray-400" />
                Stock History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {adjustments.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No stock adjustments yet</p>
              ) : (
                <div className="space-y-3">
                  {adjustments.map((adj) => (
                    <div 
                      key={adj.id} 
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${
                          adj.quantity_change > 0 ? 'bg-green-100' : 'bg-red-100'
                        }`}>
                          {adj.quantity_change > 0 ? (
                            <ArrowDown className="h-4 w-4 text-green-600" />
                          ) : (
                            <ArrowUp className="h-4 w-4 text-red-600" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {getReasonLabel(adj.reason)}
                          </p>
                          <p className="text-sm text-gray-500">
                            {format(new Date(adj.created_at), 'MMM d, yyyy h:mm a')}
                            {adj.jobs && (
                              <span className="ml-2">
                                • Job #{adj.jobs.job_number || adj.jobs.id.slice(0, 8)}
                              </span>
                            )}
                          </p>
                          {adj.notes && (
                            <p className="text-sm text-gray-500 mt-1">{adj.notes}</p>
                          )}
                        </div>
                      </div>
                      <span className={`font-bold text-lg ${
                        adj.quantity_change > 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {adj.quantity_change > 0 ? '+' : ''}{adj.quantity_change}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Usage on Jobs */}
          {jobParts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent Job Usage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {jobParts.map((part) => (
                    <div 
                      key={part.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div>
                        <p className="font-medium">
                          Job #{part.jobs?.job_number || part.job_id.slice(0, 8)}
                        </p>
                        <p className="text-sm text-gray-500">{part.jobs?.job_type}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">Qty: {part.quantity_used}</p>
                        <p className="text-sm text-gray-500">@ ${Number(part.unit_price).toFixed(2)}</p>
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
          {/* Stock Status */}
          <Card className={isLowStock ? 'border-yellow-300 bg-yellow-50' : ''}>
            <CardContent className="py-6 text-center">
              <div className={`text-5xl font-bold ${
                isOutOfStock ? 'text-red-600' :
                isLowStock ? 'text-yellow-600' :
                'text-gray-900'
              }`}>
                {item.quantity}
              </div>
              <p className="text-gray-500 mt-1">In Stock</p>
              {isLowStock && (
                <div className="flex items-center justify-center gap-2 mt-3 text-yellow-600">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm">Below reorder level ({item.reorder_level})</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card>
            <CardHeader>
              <CardTitle>Value</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-500">Unit Cost</span>
                <span className="font-medium">${Number(item.unit_cost).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total Value</span>
                <span className="font-bold text-lg">
                  ${(item.quantity * Number(item.unit_cost)).toFixed(2)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Adjustment Modal */}
      <Dialog open={adjustmentModal.open} onOpenChange={(open) => setAdjustmentModal({ ...adjustmentModal, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {adjustmentModal.type === 'add' ? 'Add Stock' : 'Remove Stock'}
            </DialogTitle>
            <DialogDescription>
              {item.name} (Current: {item.quantity})
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                min="1"
                value={adjustmentQuantity}
                onChange={(e) => setAdjustmentQuantity(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Reason</Label>
              <Select value={adjustmentReason} onValueChange={setAdjustmentReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {adjustmentModal.type === 'add' ? (
                    <>
                      <SelectItem value="purchase">Purchase/Received</SelectItem>
                      <SelectItem value="return">Return from job</SelectItem>
                      <SelectItem value="inventory_count">Inventory count</SelectItem>
                      <SelectItem value="manual_adjustment">Manual adjustment</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="job_usage">Used on job</SelectItem>
                      <SelectItem value="damaged">Damaged/Lost</SelectItem>
                      <SelectItem value="inventory_count">Inventory count</SelectItem>
                      <SelectItem value="manual_adjustment">Manual adjustment</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={adjustmentNotes}
                onChange={(e) => setAdjustmentNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustmentModal({ open: false, type: 'add' })}>
              Cancel
            </Button>
            <Button onClick={handleAdjustment} disabled={!adjustmentQuantity || adjusting}>
              {adjusting ? 'Saving...' : adjustmentModal.type === 'add' ? 'Add Stock' : 'Remove Stock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
