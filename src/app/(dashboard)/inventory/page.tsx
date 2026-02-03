'use client';

import { useState } from 'react';
import { Plus, Search, Package, AlertTriangle, ArrowDown, ArrowUp, Filter, Truck, DollarSign, MoreVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// Mock data - will be replaced with Supabase
const mockInventory = [
  { 
    id: '1', 
    sku: 'PUMP-3HP-230',
    name: '3HP Submersible Pump',
    category: 'Pumps',
    vendor: 'Franklin Electric',
    quantity: 4,
    reorderPoint: 2,
    cost: 850.00,
    price: 1200.00,
    location: 'Warehouse A',
    specs: { hp: 3, voltage: 230, gpm: 25 }
  },
  { 
    id: '2', 
    sku: 'PUMP-1HP-230',
    name: '1HP Submersible Pump',
    category: 'Pumps',
    vendor: 'Franklin Electric',
    quantity: 6,
    reorderPoint: 3,
    cost: 425.00,
    price: 650.00,
    location: 'Warehouse A',
    specs: { hp: 1, voltage: 230, gpm: 12 }
  },
  { 
    id: '3', 
    sku: 'MOTOR-5HP-230',
    name: '5HP Pump Motor',
    category: 'Motors',
    vendor: 'Franklin Electric',
    quantity: 1,
    reorderPoint: 2,
    cost: 1200.00,
    price: 1800.00,
    location: 'Warehouse A',
    specs: { hp: 5, voltage: 230, phase: 1 }
  },
  { 
    id: '4', 
    sku: 'TANK-86GAL',
    name: '86 Gallon Pressure Tank',
    category: 'Pressure Tanks',
    vendor: 'Well-X-Trol',
    quantity: 3,
    reorderPoint: 2,
    cost: 650.00,
    price: 950.00,
    location: 'Warehouse B',
    specs: { gallons: 86 }
  },
  { 
    id: '5', 
    sku: 'WIRE-10AWG-500',
    name: '10 AWG Submersible Wire (500ft)',
    category: 'Wire & Electrical',
    vendor: 'Southwire',
    quantity: 2,
    reorderPoint: 3,
    cost: 425.00,
    price: 575.00,
    location: 'Warehouse A',
    specs: { awg: 10, length: 500 }
  },
  { 
    id: '6', 
    sku: 'PIPE-2IN-20FT',
    name: '2" Drop Pipe (20ft)',
    category: 'Pipe & Fittings',
    vendor: 'Ferguson',
    quantity: 45,
    reorderPoint: 20,
    cost: 85.00,
    price: 125.00,
    location: 'Yard',
  },
  { 
    id: '7', 
    sku: 'VFD-5HP',
    name: '5HP Variable Frequency Drive',
    category: 'Motors',
    vendor: 'Grundfos',
    quantity: 0,
    reorderPoint: 1,
    cost: 2100.00,
    price: 2800.00,
    location: 'Warehouse A',
    specs: { hp: 5 }
  },
];

const categories = ['All', 'Pumps', 'Motors', 'Pressure Tanks', 'Wire & Electrical', 'Pipe & Fittings', 'Well Components', 'Filtration'];

export default function InventoryPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [showLowStock, setShowLowStock] = useState(false);
  const [showNewItemModal, setShowNewItemModal] = useState(false);

  // Filter items
  const filteredItems = mockInventory.filter(item => {
    const matchesSearch = 
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'All' || item.category === categoryFilter;
    const matchesStock = !showLowStock || item.quantity <= item.reorderPoint;
    return matchesSearch && matchesCategory && matchesStock;
  });

  // Stats
  const totalItems = mockInventory.length;
  const lowStockCount = mockInventory.filter(i => i.quantity <= i.reorderPoint).length;
  const outOfStockCount = mockInventory.filter(i => i.quantity === 0).length;
  const totalValue = mockInventory.reduce((sum, i) => sum + (i.quantity * i.cost), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-gray-500">Parts and equipment tracking</p>
        </div>
        <div className="flex gap-2">
          <button className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            <Truck className="h-4 w-4" />
            Purchase Order
          </button>
          <button 
            onClick={() => setShowNewItemModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </button>
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
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-900">Cost</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-900">Price</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Location</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    <Package className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p className="font-medium">No items found</p>
                    <p className="text-sm mt-1">Try adjusting your search or filters</p>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-900">{item.name}</p>
                        <p className="text-sm text-gray-500">{item.vendor}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">{item.sku}</td>
                    <td className="px-4 py-3">
                      <Badge variant="default" size="sm">{item.category}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${
                        item.quantity === 0 ? 'text-red-600' :
                        item.quantity <= item.reorderPoint ? 'text-yellow-600' :
                        'text-gray-900'
                      }`}>
                        {item.quantity}
                      </span>
                      {item.quantity <= item.reorderPoint && (
                        <div className="text-xs text-gray-500">
                          Reorder at {item.reorderPoint}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600">
                      ${item.cost.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">
                      ${item.price.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.location}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button 
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                          title="Add stock"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button 
                          className="p-1.5 text-orange-600 hover:bg-orange-50 rounded transition-colors"
                          title="Use stock"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button className="p-1.5 text-gray-400 hover:bg-gray-100 rounded transition-colors">
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Recent Activity</h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">3HP Submersible Pump used on Job #1752</span>
              <span className="text-gray-400">2 hrs ago</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Received 5x 2" Drop Pipe from Ferguson</span>
              <span className="text-gray-400">Yesterday</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">10 AWG Wire stock adjusted (-50ft)</span>
              <span className="text-gray-400">2 days ago</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Pending Orders</h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-900 font-medium">PO-2026-0015</p>
                <p className="text-gray-500">Franklin Electric - 2 motors</p>
              </div>
              <Badge variant="warning" size="sm">In Transit</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-900 font-medium">PO-2026-0014</p>
                <p className="text-gray-500">Ferguson - Pipe fittings</p>
              </div>
              <Badge variant="info" size="sm">Ordered</Badge>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
