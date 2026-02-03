'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableEmpty } from '@/components/ui/table';
import { Search, Plus, Phone, Mail, MapPin, MoreHorizontal, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  notes: string | null;
  created_at: string;
  properties?: { id: string }[];
}

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCustomers();
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      params.set('limit', '100');
      
      const res = await fetch(`/api/customers?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.customers || []);
        setTotal(data.total || data.customers?.length || 0);
      }
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Customers</h2>
          <p className="text-gray-600">{total.toLocaleString()} total customers</p>
        </div>
        <Button href="/customers/new">
          <Plus className="h-4 w-4" />
          Add Customer
        </Button>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search customers by name, email, or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-10 pr-4 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Customers Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableCell header>Customer</TableCell>
              <TableCell header>Contact</TableCell>
              <TableCell header>Properties</TableCell>
              <TableCell header>Added</TableCell>
              <TableCell header></TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                    <span className="ml-2 text-gray-500">Loading customers...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : customers.length === 0 ? (
              <TableEmpty message={search ? "No customers match your search" : "No customers found"} />
            ) : (
              customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <Link
                      href={`/customers/${customer.id}`}
                      className="font-medium text-blue-600 hover:text-blue-800"
                    >
                      {customer.name}
                    </Link>
                    {customer.billing_address && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">
                        {customer.billing_address}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {customer.phone && (
                        <div className="flex items-center gap-1 text-sm">
                          <Phone className="h-3 w-3 text-gray-400" />
                          <a href={`tel:${customer.phone}`} className="hover:text-blue-600">
                            {customer.phone}
                          </a>
                        </div>
                      )}
                      {customer.email && (
                        <div className="flex items-center gap-1 text-sm">
                          <Mail className="h-3 w-3 text-gray-400" />
                          <a href={`mailto:${customer.email}`} className="hover:text-blue-600 truncate max-w-[180px]">
                            {customer.email}
                          </a>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <MapPin className="h-4 w-4 text-gray-400" />
                      <span>{customer.properties?.length || 0}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-500">
                      {format(new Date(customer.created_at), 'MMM d, yyyy')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <button className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
