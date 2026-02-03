'use client';

import { useState, useEffect } from 'react';
import { Plus, Package, Receipt, Trash2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { InventoryItem, JobPart, JobExpense } from '@/types/database';

interface JobPartWithItem extends JobPart {
  inventory_items: {
    id: string;
    name: string;
    sku: string | null;
    category: string;
    unit_cost: number;
  };
}

interface Props {
  jobId: string;
}

const expenseCategories = ['Fuel', 'Materials', 'Permits', 'Disposal', 'Subcontractor', 'Equipment Rental', 'Other'];

export function JobPartsExpenses({ jobId }: Props) {
  // Parts state
  const [parts, setParts] = useState<JobPartWithItem[]>([]);
  const [partsLoading, setPartsLoading] = useState(true);
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState('');
  const [partQuantity, setPartQuantity] = useState('1');
  const [partPrice, setPartPrice] = useState('');
  const [addingPart, setAddingPart] = useState(false);

  // Expenses state
  const [expenses, setExpenses] = useState<JobExpense[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expenseTotal, setExpenseTotal] = useState(0);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    description: '',
    amount: '',
    category: 'Materials',
    vendor: '',
    expense_date: new Date().toISOString().split('T')[0],
  });
  const [addingExpense, setAddingExpense] = useState(false);

  // Fetch parts
  const fetchParts = async () => {
    try {
      setPartsLoading(true);
      const res = await fetch(`/api/jobs/${jobId}/parts`);
      if (res.ok) {
        const data = await res.json();
        setParts(data.parts || []);
      }
    } catch (error) {
      console.error('Failed to fetch parts:', error);
    } finally {
      setPartsLoading(false);
    }
  };

  // Fetch expenses
  const fetchExpenses = async () => {
    try {
      setExpensesLoading(true);
      const res = await fetch(`/api/jobs/${jobId}/expenses`);
      if (res.ok) {
        const data = await res.json();
        setExpenses(data.expenses || []);
        setExpenseTotal(data.total || 0);
      }
    } catch (error) {
      console.error('Failed to fetch expenses:', error);
    } finally {
      setExpensesLoading(false);
    }
  };

  // Fetch inventory for part selection
  const fetchInventory = async () => {
    try {
      const res = await fetch('/api/inventory');
      if (res.ok) {
        const data = await res.json();
        setInventoryItems(data.items || []);
      }
    } catch (error) {
      console.error('Failed to fetch inventory:', error);
    }
  };

  useEffect(() => {
    fetchParts();
    fetchExpenses();
    fetchInventory();
  }, [jobId]);

  // Handle add part
  const handleAddPart = async () => {
    if (!selectedItem || !partQuantity) return;
    
    setAddingPart(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/parts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inventory_item_id: selectedItem,
          quantity_used: parseInt(partQuantity),
          unit_price: partPrice ? parseFloat(partPrice) : undefined,
        }),
      });
      
      if (res.ok) {
        setAddPartOpen(false);
        setSelectedItem('');
        setPartQuantity('1');
        setPartPrice('');
        fetchParts();
        fetchInventory(); // Refresh inventory counts
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to add part');
      }
    } catch (error) {
      console.error('Failed to add part:', error);
      alert('Failed to add part');
    } finally {
      setAddingPart(false);
    }
  };

  // Handle remove part
  const handleRemovePart = async (partId: string) => {
    if (!confirm('Remove this part and return to inventory?')) return;
    
    try {
      const res = await fetch(`/api/jobs/${jobId}/parts?partId=${partId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchParts();
        fetchInventory();
      }
    } catch (error) {
      console.error('Failed to remove part:', error);
    }
  };

  // Handle add expense
  const handleAddExpense = async () => {
    if (!expenseForm.description || !expenseForm.amount) return;
    
    setAddingExpense(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...expenseForm,
          amount: parseFloat(expenseForm.amount),
          job_id: jobId,
        }),
      });
      
      if (res.ok) {
        setAddExpenseOpen(false);
        setExpenseForm({
          description: '',
          amount: '',
          category: 'Materials',
          vendor: '',
          expense_date: new Date().toISOString().split('T')[0],
        });
        fetchExpenses();
      }
    } catch (error) {
      console.error('Failed to add expense:', error);
    } finally {
      setAddingExpense(false);
    }
  };

  // Handle delete expense
  const handleDeleteExpense = async (expenseId: string) => {
    if (!confirm('Delete this expense?')) return;
    
    try {
      const res = await fetch(`/api/expenses/${expenseId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchExpenses();
      }
    } catch (error) {
      console.error('Failed to delete expense:', error);
    }
  };

  // Calculate parts total
  const partsTotal = parts.reduce((sum, p) => sum + (p.quantity_used * Number(p.unit_price)), 0);

  // Get selected item details for price suggestion
  const selectedItemDetails = inventoryItems.find(i => i.id === selectedItem);

  return (
    <div className="space-y-6">
      {/* Parts Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-gray-400" />
            Parts Used
            {partsTotal > 0 && (
              <span className="text-sm font-normal text-gray-500 ml-2">
                (${partsTotal.toFixed(2)})
              </span>
            )}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setAddPartOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Part
          </Button>
        </CardHeader>
        <CardContent>
          {partsLoading ? (
            <div className="text-center py-4">
              <RefreshCw className="h-5 w-5 mx-auto animate-spin text-gray-400" />
            </div>
          ) : parts.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No parts added yet</p>
          ) : (
            <div className="space-y-2">
              {parts.map((part) => (
                <div 
                  key={part.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-900">{part.inventory_items.name}</p>
                    <p className="text-sm text-gray-500">
                      {part.inventory_items.sku && `${part.inventory_items.sku} • `}
                      Qty: {part.quantity_used} @ ${Number(part.unit_price).toFixed(2)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">
                      ${(part.quantity_used * Number(part.unit_price)).toFixed(2)}
                    </span>
                    <button
                      onClick={() => handleRemovePart(part.id)}
                      className="p-1 text-red-500 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Expenses Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-gray-400" />
            Job Expenses
            {expenseTotal > 0 && (
              <span className="text-sm font-normal text-gray-500 ml-2">
                (${expenseTotal.toFixed(2)})
              </span>
            )}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setAddExpenseOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Expense
          </Button>
        </CardHeader>
        <CardContent>
          {expensesLoading ? (
            <div className="text-center py-4">
              <RefreshCw className="h-5 w-5 mx-auto animate-spin text-gray-400" />
            </div>
          ) : expenses.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No expenses logged</p>
          ) : (
            <div className="space-y-2">
              {expenses.map((expense) => (
                <div 
                  key={expense.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-900">{expense.description}</p>
                    <p className="text-sm text-gray-500">
                      {expense.category}
                      {expense.vendor && ` • ${expense.vendor}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">${Number(expense.amount).toFixed(2)}</span>
                    <button
                      onClick={() => handleDeleteExpense(expense.id)}
                      className="p-1 text-red-500 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Part Modal */}
      <Dialog open={addPartOpen} onOpenChange={setAddPartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Part to Job</DialogTitle>
            <DialogDescription>
              Select a part from inventory. Stock will be automatically deducted.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Part</Label>
              <Select value={selectedItem} onValueChange={(v) => {
                setSelectedItem(v);
                const item = inventoryItems.find(i => i.id === v);
                if (item) setPartPrice(String(item.unit_cost));
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select part..." />
                </SelectTrigger>
                <SelectContent>
                  {inventoryItems.map((item) => (
                    <SelectItem 
                      key={item.id} 
                      value={item.id}
                      disabled={item.quantity === 0}
                    >
                      {item.name} ({item.quantity} in stock)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min="1"
                  max={selectedItemDetails?.quantity || 999}
                  value={partQuantity}
                  onChange={(e) => setPartQuantity(e.target.value)}
                />
                {selectedItemDetails && (
                  <p className="text-xs text-gray-500">
                    {selectedItemDetails.quantity} available
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label>Unit Price ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={partPrice}
                  onChange={(e) => setPartPrice(e.target.value)}
                  placeholder={selectedItemDetails ? String(selectedItemDetails.unit_cost) : '0.00'}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPartOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAddPart}
              disabled={!selectedItem || !partQuantity || addingPart}
            >
              {addingPart ? 'Adding...' : 'Add Part'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Expense Modal */}
      <Dialog open={addExpenseOpen} onOpenChange={setAddExpenseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Job Expense</DialogTitle>
            <DialogDescription>
              Log an expense for this job
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Description</Label>
              <Input
                value={expenseForm.description}
                onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                placeholder="What was purchased?"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={expenseForm.amount}
                  onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select 
                  value={expenseForm.category} 
                  onValueChange={(v) => setExpenseForm({ ...expenseForm, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {expenseCategories.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Vendor</Label>
                <Input
                  value={expenseForm.vendor}
                  onChange={(e) => setExpenseForm({ ...expenseForm, vendor: e.target.value })}
                  placeholder="Supplier name"
                />
              </div>
              <div className="grid gap-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={expenseForm.expense_date}
                  onChange={(e) => setExpenseForm({ ...expenseForm, expense_date: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddExpenseOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAddExpense}
              disabled={!expenseForm.description || !expenseForm.amount || addingExpense}
            >
              {addingExpense ? 'Adding...' : 'Add Expense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
