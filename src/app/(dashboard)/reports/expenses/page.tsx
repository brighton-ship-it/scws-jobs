'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { 
  ArrowLeft,
  DollarSign,
  Download,
  RefreshCw,
  PieChart,
  TrendingUp,
  Calendar
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { JobExpense } from '@/types/database'
import { format, startOfMonth, endOfMonth, subMonths, parseISO } from 'date-fns'

interface ExpenseWithJob extends JobExpense {
  jobs?: { id: string; job_type: string; job_number?: string } | null;
}

const categories = ['Materials', 'Fuel', 'Equipment Rental', 'Subcontractor', 'Permits', 'Disposal', 'Other']

const categoryColors: Record<string, string> = {
  'Materials': '#3b82f6',
  'Fuel': '#eab308',
  'Equipment Rental': '#8b5cf6',
  'Subcontractor': '#f97316',
  'Permits': '#22c55e',
  'Disposal': '#ef4444',
  'Other': '#6b7280',
}

export default function ExpenseReportsPage() {
  const [expenses, setExpenses] = useState<ExpenseWithJob[]>([])
  const [loading, setLoading] = useState(true)
  
  const now = new Date()
  const [startDate, setStartDate] = useState(format(startOfMonth(subMonths(now, 2)), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(now), 'yyyy-MM-dd'))

  const fetchExpenses = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      
      const res = await fetch(`/api/expenses?${params}`)
      if (res.ok) {
        const data = await res.json()
        setExpenses(data.expenses || [])
      }
    } catch (error) {
      console.error('Failed to fetch expenses:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchExpenses()
  }, [startDate, endDate])

  // Calculate stats
  const stats = useMemo(() => {
    const byCategory: Record<string, number> = {}
    const byMonth: Record<string, number> = {}
    let total = 0
    let jobLinked = 0
    let general = 0
    
    expenses.forEach(exp => {
      const amount = Number(exp.amount)
      total += amount
      
      // By category
      byCategory[exp.category] = (byCategory[exp.category] || 0) + amount
      
      // By month
      const month = format(parseISO(exp.expense_date), 'yyyy-MM')
      byMonth[month] = (byMonth[month] || 0) + amount
      
      // Job vs General
      if (exp.job_id) {
        jobLinked += amount
      } else {
        general += amount
      }
    })
    
    return { byCategory, byMonth, total, jobLinked, general }
  }, [expenses])

  // Sort categories by amount
  const sortedCategories = useMemo(() => {
    return Object.entries(stats.byCategory)
      .sort(([, a], [, b]) => b - a)
  }, [stats.byCategory])

  // Sort months
  const sortedMonths = useMemo(() => {
    return Object.entries(stats.byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
  }, [stats.byMonth])

  const maxCategoryAmount = Math.max(...Object.values(stats.byCategory), 1)
  const maxMonthAmount = Math.max(...Object.values(stats.byMonth), 1)

  const exportCSV = () => {
    const headers = ['Date', 'Description', 'Category', 'Vendor', 'Amount', 'Job']
    const rows = expenses.map(e => [
      e.expense_date,
      e.description,
      e.category,
      e.vendor || '',
      e.amount,
      e.jobs?.job_number || e.job_id || ''
    ])
    
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `expenses-${startDate}-to-${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/expenses" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Expense Reports</h1>
            <p className="text-muted-foreground">
              Analyze expenses by category and time period
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchExpenses}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="outline" onClick={exportCSV}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Date Range Filter */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="grid gap-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  setStartDate(format(startOfMonth(now), 'yyyy-MM-dd'))
                  setEndDate(format(endOfMonth(now), 'yyyy-MM-dd'))
                }}
              >
                This Month
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  setStartDate(format(startOfMonth(subMonths(now, 2)), 'yyyy-MM-dd'))
                  setEndDate(format(endOfMonth(now), 'yyyy-MM-dd'))
                }}
              >
                Last 3 Months
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.total.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">{expenses.length} expenses</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Job-Linked</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.jobLinked.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {stats.total > 0 ? ((stats.jobLinked / stats.total) * 100).toFixed(0) : 0}% of total
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">General/Overhead</CardTitle>
            <PieChart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.general.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {stats.total > 0 ? ((stats.general / stats.total) * 100).toFixed(0) : 0}% of total
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Categories</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Object.keys(stats.byCategory).length}</div>
            <p className="text-xs text-muted-foreground">expense categories</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* By Category */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-gray-400" />
              By Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <RefreshCw className="h-6 w-6 mx-auto animate-spin text-gray-400" />
              </div>
            ) : sortedCategories.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">No expenses in this period</p>
            ) : (
              <div className="space-y-4">
                {sortedCategories.map(([category, amount]) => (
                  <div key={category}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{category}</span>
                      <span className="text-muted-foreground">
                        ${amount.toLocaleString()} ({((amount / stats.total) * 100).toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full transition-all"
                        style={{ 
                          width: `${(amount / maxCategoryAmount) * 100}%`,
                          backgroundColor: categoryColors[category] || '#6b7280'
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* By Month */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-gray-400" />
              By Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <RefreshCw className="h-6 w-6 mx-auto animate-spin text-gray-400" />
              </div>
            ) : sortedMonths.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">No expenses in this period</p>
            ) : (
              <div className="space-y-4">
                {sortedMonths.map(([month, amount]) => (
                  <div key={month}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{format(parseISO(month + '-01'), 'MMMM yyyy')}</span>
                      <span className="text-muted-foreground">${amount.toLocaleString()}</span>
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${(amount / maxMonthAmount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle>Category Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b">
                <tr>
                  <th className="text-left py-3 px-4 font-semibold">Category</th>
                  <th className="text-right py-3 px-4 font-semibold">Count</th>
                  <th className="text-right py-3 px-4 font-semibold">Total</th>
                  <th className="text-right py-3 px-4 font-semibold">Avg</th>
                  <th className="text-right py-3 px-4 font-semibold">% of Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {categories.map(category => {
                  const catExpenses = expenses.filter(e => e.category === category)
                  const catTotal = catExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
                  const catAvg = catExpenses.length > 0 ? catTotal / catExpenses.length : 0
                  const pct = stats.total > 0 ? (catTotal / stats.total) * 100 : 0
                  
                  if (catExpenses.length === 0) return null
                  
                  return (
                    <tr key={category} className="hover:bg-muted/50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: categoryColors[category] }}
                          />
                          {category}
                        </div>
                      </td>
                      <td className="text-right py-3 px-4">{catExpenses.length}</td>
                      <td className="text-right py-3 px-4 font-medium">${catTotal.toLocaleString()}</td>
                      <td className="text-right py-3 px-4 text-muted-foreground">${catAvg.toFixed(2)}</td>
                      <td className="text-right py-3 px-4 text-muted-foreground">{pct.toFixed(1)}%</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t bg-muted/50">
                <tr>
                  <td className="py-3 px-4 font-semibold">Total</td>
                  <td className="text-right py-3 px-4 font-semibold">{expenses.length}</td>
                  <td className="text-right py-3 px-4 font-semibold">${stats.total.toLocaleString()}</td>
                  <td className="text-right py-3 px-4 text-muted-foreground">
                    ${expenses.length > 0 ? (stats.total / expenses.length).toFixed(2) : '0.00'}
                  </td>
                  <td className="text-right py-3 px-4">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
