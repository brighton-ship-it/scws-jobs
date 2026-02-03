'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, Package, AlertTriangle, ArrowDown, ArrowUp, DollarSign, MoreVertical, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { InventoryItem } from '@/types/database';

const categories = ['All', 'Pumps', 'Motors', 'Tanks', 'Fittings', 'Wire', 'Controls', 'Misc'];

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [showLowStock, setShowLowStock] = useState(false);
  
  // Adjustment modal state
  const [adjustmentModal, setAdjustmentModal] = useState<{
    open: boolean;
    item: InventoryItem | null;
    type: 'add' | 'remove';
  }>({ open: false, item: null, type: 'add' });
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('manual_adjustment');
  const [adjustmentNotes, setAdjustmentNotes] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const fetchInventory = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (categoryFilter !== 'All') params.set('category', categoryFilter);
      if (searchQuery) params.set('search', searchQuery);
      if (showLowStock) params.set('lowStock', 'true');
      
      const res = await fetch(`/api/inventory?${params}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch (error) {
      console.error('Failed to fetch inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, [categoryFilter, showLowStock]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchInventory();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleAdjustment = async () => {
    if (!adjustmentModal.item || !adjustmentQuantity) return;
    
    setAdjusting(true);
    try {
      const quantity = parseInt(adjustmentQuantity);
      const quantityChange = adjustmentModal.type === 'add' ? quantity : -quantity;
      
      const res = await fetch(`/api/inventory/${adjustmentModal.item.id}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity_change: quantityChange,
          reason: adjustmentReason,
          notes: adjustmentNotes || null,
        }),
      });
      
      if (res.ok) {
        setAdjustmentModal({ open: false, item: null, type: 'add' });
        setAdjustmentQuantity('');
        setAdjustmentNotes('');
        fetchInventory();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to adjust stock');
      }
    } catch (error) {
      console.error('Adjustment failed:', error);
      alert('Failed to adjust stock');
    } finally {
      setAdjusting(false);
    }
  };

  // Stats
  const totalItems = items.length;
  const lowStockCount = items.filter(i => i.quantity <= i.reorder_level).length;
  const outOfStockCount = items.filter(i => i.quantity === 0).length;
  const totalValue = items.reduce((sum, i) => sum + (i.quantity * Number(i.unit_cost)), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-gray-500">Parts and equipment tracking</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchInventory}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Link href="/inventory/new">
            <Button>
              <Plus className="h-4 w-4" />
              Add Item
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalItems}</p>
              <p className="text-sm text-gray-500">Total Items</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{lowStockCount}</p>
              <p className="text-sm text-gray-500">Low Stock</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <Package className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{outOfStockCount}</p>
              <p className="text-sm text-gray-500">Out of Stock</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <DollarSign className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">${totalValue.toLocaleString()}</p>
              <p className="text-sm text-gray-500">Total Value</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <button
            onClick={() => setShowLowStock(!showLowStock)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
              showLowStock 
                ? 'bg-yellow-50 border-yellow-300 text-yellow-700' 
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
            Low Stock Only
          </button>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Item</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">SKU</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Category</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-900">Qty</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-900">Unit Cost</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Location</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin text-gray-400" />
                    Loading...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    <Package className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p className="font-medium">No items found</p>
                    <p className="text-sm mt-1">Try adjusting your search or filters</p>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/inventory/${item.id}`} className="block hover:text-green-600">
                        <p className="font-medium text-gray-900">{item.name}</p>
                        {item.vendor && <p className="text-sm text-gray-500">{item.vendor}</p>}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">{item.sku || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant="default" size="sm">{item.category}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${
                        item.quantity === 0 ? 'text-red-600' :
                        item.quantity <= item.reorder_level ? 'text-yellow-600' :
                        'text-gray-900'
                      }`}>
                        {item.quantity}
                      </span>
                      {item.quantity <= item.reorder_level && (
                        <div className="text-xs text-gray-500">
                          Reorder at {item.reorder_level}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600">
                      ${Number(item.unit_cost).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.location || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button 
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                          title="Add stock"
                          onClick={() => setAdjustmentModal({ open: true, item, type: 'add' })}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button 
                          className="p-1.5 text-orange-600 hover:bg-orange-50 rounded transition-colors"
                          title="Use stock"
                          onClick={() => setAdjustmentModal({ open: true, item, type: 'remove' })}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <Link href={`/inventory/${item.id}`}>
                          <button className="p-1.5 text-gray-400 hover:bg-gray-100 rounded transition-colors">
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Adjustment Modal */}
      <Dialog open={adjustmentModal.open} onOpenChange={(open) => setAdjustmentModal({ ...adjustmentModal, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {adjustmentModal.type === 'add' ? 'Add Stock' : 'Remove Stock'}
            </DialogTitle>
            <DialogDescription>
              {adjustmentModal.item?.name} (Current: {adjustmentModal.item?.quantity})
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={adjustmentQuantity}
                onChange={(e) => setAdjustmentQuantity(e.target.value)}
                placeholder="Enter quantity"
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
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={adjustmentNotes}
                onChange={(e) => setAdjustmentNotes(e.target.value)}
                placeholder="Add notes..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setAdjustmentModal({ open: false, item: null, type: 'add' })}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleAdjustment}
              disabled={!adjustmentQuantity || adjusting}
            >
              {adjusting ? 'Saving...' : adjustmentModal.type === 'add' ? 'Add Stock' : 'Remove Stock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
