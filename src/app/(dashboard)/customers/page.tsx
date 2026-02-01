'use client';


import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableEmpty } from '@/components/ui/Table';
import { mockCustomers, getPropertiesByCustomerId, getJobsByCustomerId } from '@/lib/mock-data';
import { Search, Plus, Phone, Mail, MapPin, MoreHorizontal } from 'lucide-react';
import { format } from 'date-fns';

export default function CustomersPage() {
  const [search, setSearch] = useState('');

  const filteredCustomers = mockCustomers.filter((customer) =>
    customer.name.toLowerCase().includes(search.toLowerCase()) ||
    customer.email?.toLowerCase().includes(search.toLowerCase()) ||
    customer.phone?.includes(search)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Customers</h2>
          <p className="text-gray-600">{mockCustomers.length} total customers</p>
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
                placeholder="Search customers..."
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
              <TableCell header>Jobs</TableCell>
              <TableCell header>Added</TableCell>
              <TableCell header></TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCustomers.length === 0 ? (
              <TableEmpty message="No customers found" />
            ) : (
              filteredCustomers.map((customer) => {
                const properties = getPropertiesByCustomerId(customer.id);
                const jobs = getJobsByCustomerId(customer.id);

                return (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <Link
                        href={`/customers/${customer.id}`}
                        className="font-medium text-blue-600 hover:text-blue-800"
                      >
                        {customer.name}
                      </Link>
                      {customer.notes && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">
                          {customer.notes}
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
                        <span>{properties.length}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-700">{jobs.length} jobs</span>
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
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
