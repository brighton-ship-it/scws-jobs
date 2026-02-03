'use client';


import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, JobStatusBadge } from '@/components/ui/badge';
import {
  getCustomerById,
  getPropertiesByCustomerId,
  getWellInfoByPropertyId,
  getJobsByCustomerId,
  getUserById,
  getPropertyById,
} from '@/lib/mock-data';
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Edit,
  Plus,
  Droplets,
  Briefcase,
  Calendar,
  ChevronRight,
} from 'lucide-react';
import { format } from 'date-fns';

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const customer = getCustomerById(id);

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-lg text-gray-600">Customer not found</p>
        <Button href="/customers" variant="outline" className="mt-4">
          <ArrowLeft className="h-4 w-4" />
          Back to Customers
        </Button>
      </div>
    );
  }

  const properties = getPropertiesByCustomerId(customer.id);
  const jobs = getJobsByCustomerId(customer.id);

  // Sort jobs by date, most recent first
  const sortedJobs = [...jobs].sort((a, b) => {
    const dateA = a.scheduled_date ? new Date(a.scheduled_date).getTime() : 0;
    const dateB = b.scheduled_date ? new Date(b.scheduled_date).getTime() : 0;
    return dateB - dateA;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-gray-900">{customer.name}</h2>
          <p className="text-gray-600">
            Customer since {format(new Date(customer.created_at), 'MMMM yyyy')}
          </p>
        </div>
        <Button variant="outline" href={`/customers/${id}/edit`}>
          <Edit className="h-4 w-4" />
          Edit
        </Button>
        <Button href={`/jobs/new?customer=${id}`}>
          <Plus className="h-4 w-4" />
          New Job
        </Button>
      </div>

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Contact Info */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {customer.phone && (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                  <Phone className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Phone</p>
                  <a
                    href={`tel:${customer.phone}`}
                    className="font-medium text-gray-900 hover:text-blue-600"
                  >
                    {customer.phone}
                  </a>
                </div>
              </div>
            )}

            {customer.email && (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                  <Mail className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Email</p>
                  <a
                    href={`mailto:${customer.email}`}
                    className="font-medium text-gray-900 hover:text-blue-600"
                  >
                    {customer.email}
                  </a>
                </div>
              </div>
            )}

            {customer.billing_address && (
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                  <MapPin className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Billing Address</p>
                  <p className="font-medium text-gray-900">{customer.billing_address}</p>
                </div>
              </div>
            )}

            {customer.notes && (
              <div className="pt-4 border-t border-gray-200">
                <p className="text-sm text-gray-500 mb-1">Notes</p>
                <p className="text-sm text-gray-700">{customer.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Properties */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Properties ({properties.length})</CardTitle>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4" />
              Add Property
            </Button>
          </CardHeader>
          <CardContent>
            {properties.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">
                No properties yet
              </p>
            ) : (
              <div className="space-y-4">
                {properties.map((property) => {
                  const wellInfo = getWellInfoByPropertyId(property.id);

                  return (
                    <div
                      key={property.id}
                      className="rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                            <MapPin className="h-5 w-5 text-gray-600" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{property.address}</p>
                            <p className="text-sm text-gray-600">
                              {property.city}, {property.county} County {property.zip}
                            </p>
                            {property.access_notes && (
                              <p className="text-sm text-gray-500 mt-1">
                                📝 {property.access_notes}
                              </p>
                            )}
                          </div>
                        </div>
                        {wellInfo && (
                          <Badge variant="info">
                            <Droplets className="h-3 w-3 mr-1" />
                            Well Info
                          </Badge>
                        )}
                      </div>

                      {wellInfo && (
                        <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg bg-blue-50 p-3 sm:grid-cols-4">
                          <div>
                            <p className="text-xs text-blue-600">Well Depth</p>
                            <p className="font-medium text-blue-900">{wellInfo.well_depth} ft</p>
                          </div>
                          <div>
                            <p className="text-xs text-blue-600">Casing</p>
                            <p className="font-medium text-blue-900">{wellInfo.casing_diameter}&quot;</p>
                          </div>
                          <div>
                            <p className="text-xs text-blue-600">Pump Model</p>
                            <p className="font-medium text-blue-900 truncate">{wellInfo.pump_model || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-blue-600">Pump HP</p>
                            <p className="font-medium text-blue-900">{wellInfo.pump_hp || 'N/A'}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Job History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Job History ({jobs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedJobs.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">
              No jobs yet
            </p>
          ) : (
            <div className="space-y-3">
              {sortedJobs.map((job) => {
                const property = getPropertyById(job.property_id);
                const assignedUser = job.assigned_to ? getUserById(job.assigned_to) : null;

                return (
                  <Link
                    key={job.id}
                    href={`/jobs/${job.id}`}
                    className="flex items-center gap-4 rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
                      <Briefcase className="h-5 w-5 text-gray-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">{job.job_type}</p>
                        <JobStatusBadge status={job.status} />
                      </div>
                      <p className="text-sm text-gray-600 truncate">
                        {property?.address}
                      </p>
                      {job.description && (
                        <p className="text-sm text-gray-500 truncate mt-0.5">
                          {job.description}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      {job.scheduled_date && (
                        <div className="flex items-center gap-1 text-sm text-gray-600">
                          <Calendar className="h-4 w-4" />
                          {format(new Date(job.scheduled_date), 'MMM d, yyyy')}
                        </div>
                      )}
                      {assignedUser && (
                        <p className="text-sm text-gray-500">{assignedUser.name}</p>
                      )}
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
