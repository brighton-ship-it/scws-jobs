'use client'

import { useState } from 'react'
import { 
  Plus, 
  Search, 
  MoreVertical,
  Receipt,
  DollarSign,
  Calendar,
  Briefcase,
  Upload,
  Filter,
  Download
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// Mock expenses
const mockExpenses = [
  {
    id: '1',
    description: 'Grundfos SQFlex pump',
    amount: 2450.00,
    category: 'Materials',
    vendor: 'Ransom Pump Supply',
    expense_date: '2026-02-02',
    job_title: 'Well Pump Replacement - Johnson Ranch',
    receipt: true,
    created_by: 'Travis Sego',
  },
  {
    id: '2',
    description: 'Fuel - Service truck',
    amount: 125.00,
    category: 'Fuel',
    vendor: 'Chevron',
    expense_date: '2026-02-02',
    job_title: null,
    receipt: true,
    created_by: 'Brian Eads',
  },
  {
    id: '3',
    description: '4" PVC well casing (100ft)',
    amount: 850.00,
    category: 'Materials',
    vendor: 'Ferguson Waterworks',
    expense_date: '2026-02-01',
    job_title: 'Well Drilling - Desert Oasis',
    receipt: true,
    created_by: 'Austin Tipton',
  },
  {
    id: '4',
    description: 'Permit fee - San Diego County',
    amount: 275.00,
    category: 'Permits',
    vendor: 'SD County',
    expense_date: '2026-02-01',
    job_title: 'Well Drilling - Desert Oasis',
    receipt: false,
    created_by: 'Brighton Scala',
  },
  {
    id: '5',
    description: 'Backhoe rental (1 day)',
    amount: 450.00,
    category: 'Equipment Rental',
    vendor: 'Sunbelt Rentals',
    expense_date: '2026-01-31',
    job_title: 'Septic Line Repair - Wilson',
    receipt: true,
    created_by: 'Jeff Gezewski',
  },
]

const categories = ['Materials', 'Fuel', 'Equipment Rental', 'Subcontractor', 'Permits', 'Disposal', 'Other']

function getCategoryColor(category: string) {
  const colors: Record<string, string> = {
    'Materials': 'bg-blue-100 text-blue-800',
    'Fuel': 'bg-yellow-100 text-yellow-800',
    'Equipment Rental': 'bg-purple-100 text-purple-800',
    'Subcontractor': 'bg-orange-100 text-orange-800',
    'Permits': 'bg-green-100 text-green-800',
    'Disposal': 'bg-red-100 text-red-800',
    'Other': 'bg-gray-100 text-gray-800',
  }
  return colors[category] || 'bg-gray-100 text-gray-800'
}

export default function ExpensesPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [dateRange, setDateRange] = useState('month')

  const filteredExpenses = mockExpenses.filter(exp => {
    const matchesSearch = 
      exp.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exp.vendor.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = categoryFilter === 'all' || exp.category === categoryFilter
    return matchesSearch && matchesCategory
  })

  const stats = {
    total: mockExpenses.reduce((sum, e) => sum + e.amount, 0),
    thisMonth: mockExpenses.filter(e => e.expense_date.startsWith('2026-02')).reduce((sum, e) => sum + e.amount, 0),
    materials: mockExpenses.filter(e => e.category === 'Materials').reduce((sum, e) => sum + e.amount, 0),
    withoutReceipt: mockExpenses.filter(e => !e.receipt).length,
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Expenses</h1>
          <p className="text-muted-foreground">
            Track job costs, receipts, and calculate profitability
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Expense
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Add Expense</DialogTitle>
                <DialogDescription>
                  Log a job expense or general business cost
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="description">Description</Label>
                  <Input id="description" placeholder="What was purchased?" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="amount">Amount</Label>
                    <Input id="amount" type="number" placeholder="0.00" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Category</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="vendor">Vendor</Label>
                    <Input id="vendor" placeholder="Supplier name" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="date">Date</Label>
                    <Input id="date" type="date" defaultValue={new Date().toISOString().split('T')[0]} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Link to Job (Optional)</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select job" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No job - General expense</SelectItem>
                      <SelectItem value="1">Well Pump Replacement - Johnson Ranch</SelectItem>
                      <SelectItem value="2">Well Drilling - Desert Oasis</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Receipt</Label>
                  <div className="border-2 border-dashed rounded-lg p-6 text-center">
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Drag & drop or click to upload receipt
                    </p>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setIsCreateOpen(false)}>
                  Save Expense
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.total.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.thisMonth.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">February 2026</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Materials</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.materials.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Largest category</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Missing Receipts</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.withoutReceipt}</div>
            <p className="text-xs text-muted-foreground">Need to upload</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search expenses..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Expenses List */}
      <Card>
        <CardContent className="p-0">
          {filteredExpenses.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No expenses found
            </div>
          ) : (
            <div className="divide-y">
              {filteredExpenses.map((expense) => (
                <div 
                  key={expense.id}
                  className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-full bg-muted">
                      <Receipt className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{expense.description}</h4>
                        <Badge className={getCategoryColor(expense.category)}>
                          {expense.category}
                        </Badge>
                        {!expense.receipt && (
                          <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                            No Receipt
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-3 mt-1">
                        <span>{expense.vendor}</span>
                        <span>•</span>
                        <span>{new Date(expense.expense_date).toLocaleDateString()}</span>
                        {expense.job_title && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Briefcase className="h-3 w-3" />
                              {expense.job_title}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xl font-bold">${expense.amount.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">by {expense.created_by}</div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>Edit</DropdownMenuItem>
                        <DropdownMenuItem>View Receipt</DropdownMenuItem>
                        <DropdownMenuItem>Link to Job</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
