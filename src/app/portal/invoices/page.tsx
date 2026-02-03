'use client'

import { useState } from 'react'
import Link from 'next/link'
import { 
  FileText, 
  Download,
  CreditCard,
  CheckCircle,
  Clock,
  AlertCircle,
  ChevronRight,
  DollarSign,
  Calendar
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

// Mock customer invoices
const mockInvoices = [
  {
    id: 'INV-2026-0142',
    job_type: 'Well Pump Replacement',
    date: '2026-02-01',
    due_date: '2026-02-15',
    amount: 3200.00,
    amount_paid: 0,
    status: 'pending',
    property_address: '12345 Desert View Rd',
  },
  {
    id: 'INV-2026-0098',
    job_type: 'Annual Well Inspection',
    date: '2026-01-15',
    due_date: '2026-01-29',
    amount: 250.00,
    amount_paid: 250.00,
    status: 'paid',
    property_address: '12345 Desert View Rd',
  },
  {
    id: 'INV-2025-0856',
    job_type: 'Pressure Tank Service',
    date: '2025-11-20',
    due_date: '2025-12-04',
    amount: 450.00,
    amount_paid: 450.00,
    status: 'paid',
    property_address: '12345 Desert View Rd',
  },
  {
    id: 'INV-2025-0712',
    job_type: 'Well Pump Repair',
    date: '2025-09-10',
    due_date: '2025-09-24',
    amount: 1100.00,
    amount_paid: 1100.00,
    status: 'paid',
    property_address: '12345 Desert View Rd',
  },
]

function getStatusBadge(status: string, dueDate: string) {
  const isOverdue = status === 'pending' && new Date(dueDate) < new Date()
  
  if (isOverdue) {
    return <Badge className="bg-red-100 text-red-800">Overdue</Badge>
  }
  
  switch (status) {
    case 'paid':
      return <Badge className="bg-green-100 text-green-800">Paid</Badge>
    case 'pending':
      return <Badge className="bg-yellow-100 text-yellow-800">Payment Due</Badge>
    case 'partial':
      return <Badge className="bg-blue-100 text-blue-800">Partial</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export default function CustomerInvoicesPage() {
  const stats = {
    outstanding: mockInvoices
      .filter(i => i.status !== 'paid')
      .reduce((sum, i) => sum + (i.amount - i.amount_paid), 0),
    paid: mockInvoices
      .filter(i => i.status === 'paid')
      .reduce((sum, i) => sum + i.amount, 0),
    total: mockInvoices.length,
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1f3b4d] text-white py-6">
        <div className="container mx-auto px-4">
          <h1 className="text-2xl font-bold">Southern California Well Service</h1>
          <p className="text-white/80">Customer Portal - Invoices</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Navigation */}
        <div className="flex gap-2 mb-6 overflow-x-auto">
          <Link href="/portal">
            <Button variant="outline" size="sm">Dashboard</Button>
          </Link>
          <Link href="/portal/invoices">
            <Button variant="default" size="sm" className="bg-[#1f3b4d]">Invoices</Button>
          </Link>
          <Link href="/portal/history">
            <Button variant="outline" size="sm">Service History</Button>
          </Link>
          <Link href="/book">
            <Button variant="outline" size="sm">Book Service</Button>
          </Link>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Outstanding Balance</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${stats.outstanding > 0 ? 'text-red-600' : ''}`}>
                ${stats.outstanding.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Paid This Year</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                ${stats.paid.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Invoices</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
        </div>

        {/* Outstanding Invoice Alert */}
        {stats.outstanding > 0 && (
          <Card className="mb-6 border-yellow-200 bg-yellow-50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-5 w-5 text-yellow-600" />
                  <div>
                    <p className="font-medium">You have an outstanding balance</p>
                    <p className="text-sm text-muted-foreground">
                      ${stats.outstanding.toLocaleString()} due
                    </p>
                  </div>
                </div>
                <Button className="bg-[#4e9271] hover:bg-[#3d7a5c]">
                  <CreditCard className="mr-2 h-4 w-4" />
                  Pay Now
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Invoices List */}
        <Card>
          <CardHeader>
            <CardTitle>Your Invoices</CardTitle>
            <CardDescription>View and pay your invoices</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {mockInvoices.map((invoice) => (
                <div 
                  key={invoice.id}
                  className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-full ${
                      invoice.status === 'paid' ? 'bg-green-100' : 'bg-yellow-100'
                    }`}>
                      {invoice.status === 'paid' ? (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      ) : (
                        <Clock className="h-5 w-5 text-yellow-600" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{invoice.id}</h4>
                        {getStatusBadge(invoice.status, invoice.due_date)}
                      </div>
                      <p className="text-sm text-muted-foreground">{invoice.job_type}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(invoice.date).toLocaleDateString()}
                        {invoice.status !== 'paid' && (
                          <>
                            <span>•</span>
                            <span>Due: {new Date(invoice.due_date).toLocaleDateString()}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="font-bold">${invoice.amount.toLocaleString()}</div>
                      {invoice.status === 'paid' && (
                        <div className="text-xs text-green-600">Paid in full</div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="icon">
                        <Download className="h-4 w-4" />
                      </Button>
                      {invoice.status !== 'paid' && (
                        <Button size="sm" className="bg-[#4e9271] hover:bg-[#3d7a5c]">
                          Pay
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Contact */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>Questions about an invoice?</p>
          <a href="tel:+17604408520" className="text-[#1f3b4d] font-medium">
            (760) 440-8520
          </a>
          <span className="mx-2">•</span>
          <a href="mailto:billing@scwellservice.com" className="text-[#1f3b4d] font-medium">
            billing@scwellservice.com
          </a>
        </div>
      </div>
    </div>
  )
}
