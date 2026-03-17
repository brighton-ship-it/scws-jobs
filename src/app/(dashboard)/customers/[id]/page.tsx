'use client';


import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, JobStatusBadge } from '@/components/ui/badge';
import CommunicationTimeline from '@/components/customers/CommunicationTimeline';
import CustomerNotes from '@/components/customers/CustomerNotes';
import { format, differenceInDays, parseISO } from 'date-fns';
import type { CustomerEquipment, LeadSource, LeadStage } from '@/types/database';
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
  Wrench,
  AlertTriangle,
  MessageSquare,
  Target,
} from 'lucide-react';

const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  google_ads: 'Google Ads',
  organic_seo: 'Organic Search',
  referral: 'Referral',
  repeat_customer: 'Repeat Customer',
  phone: 'Phone Call',
  walk_in: 'Walk-In',
  website_form: 'Website Form',
  other: 'Other',
};

const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  lead: 'New Lead',
  quote_sent: 'Quote Sent',
  quote_accepted: 'Quote Accepted',
  job_scheduled: 'Job Scheduled',
  job_completed: 'Job Completed',
  paid: 'Paid',
};

const LEAD_STAGE_COLORS: Record<LeadStage, string> = {
  lead: 'bg-blue-100 text-blue-700',
  quote_sent: 'bg-purple-100 text-purple-700',
  quote_accepted: 'bg-amber-100 text-amber-700',
  job_scheduled: 'bg-cyan-100 text-cyan-700',
  job_completed: 'bg-green-100 text-green-700',
  paid: 'bg-emerald-100 text-emerald-700',
};

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [customer, setCustomer] = useState<any>(null);
  const [customerLoading, setCustomerLoading] = useState(true);
  const [properties, setProperties] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<CustomerEquipment[]>([]);
  const [equipmentLoading, setEquipmentLoading] = useState(true);
  const [leadInfo, setLeadInfo] = useState<{
    lead_source?: LeadSource | null;
    lead_source_detail?: string | null;
    lead_stage?: LeadStage | null;
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
  } | null>(null);

  // Fetch customer data from API
  useEffect(() => {
    const fetchCustomer = async () => {
      try {
        setCustomerLoading(true);
        const res = await fetch(`/api/customers/${id}`);
        if (res.ok) {
          const data = await res.json();
          setCustomer(data.customer);
          setProperties(data.customer?.properties || []);
          setLeadInfo({
            lead_source: data.customer?.lead_source,
            lead_source_detail: data.customer?.lead_source_detail,
            lead_stage: data.customer?.lead_stage,
            utm_source: data.customer?.utm_source,
            utm_medium: data.customer?.utm_medium,
            utm_campaign: data.customer?.utm_campaign,
          });
        }
      } catch (err) {
        console.error('Failed to fetch customer:', err);
      } finally {
        setCustomerLoading(false);
      }
    };
    fetchCustomer();
  }, [id]);

  // Fetch jobs for this customer
  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const res = await fetch(`/api/jobs?customer_id=${id}`);
        if (res.ok) {
          const data = await res.json();
          setJobs(data.jobs || []);
        }
      } catch (err) {
        console.error('Failed to fetch jobs:', err);
      }
    };
    if (id) fetchJobs();
  }, [id]);

  // Fetch equipment data
  useEffect(() => {
    const fetchEquipment = async () => {
      try {
        const res = await fetch(`/api/customers/${id}/equipment`);
        if (res.ok) {
          const data = await res.json();
          setEquipment(data.equipment || []);
        }
      } catch (err) {
        console.error('Failed to fetch equipment:', err);
      } finally {
        setEquipmentLoading(false);
      }
    };
    if (id) fetchEquipment();
  }, [id]);

  // Count expiring warranties - safely compute even when customer is null
  const expiringWarranties = equipment.filter((e) => {
    if (!e.warranty_expires) return false;
    try {
      const daysLeft = differenceInDays(parseISO(e.warranty_expires), new Date());
      return daysLeft >= 0 && daysLeft <= 30;
    } catch {
      return false;
    }
  }).length;

  const expiredWarranties = equipment.filter((e) => {
    if (!e.warranty_expires) return false;
    try {
      const daysLeft = differenceInDays(parseISO(e.warranty_expires), new Date());
      return daysLeft < 0;
    } catch {
      return false;
    }
  }).length;

  if (customerLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
        <span className="ml-3 text-gray-600">Loading customer...</span>
      </div>
    );
  }

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

  // Sort jobs by date, most recent first (jobs fetched from API)
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
        <Button variant="outline" href={`/customers/${id}/equipment`}>
          <Wrench className="h-4 w-4" />
          Equipment
          {(expiringWarranties > 0 || expiredWarranties > 0) && (
            <span className="ml-1 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">
              {expiringWarranties + expiredWarranties}
            </span>
          )}
        </Button>
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

            {/* Lead Source Info */}
            {leadInfo?.lead_source && (
              <div className="pt-4 border-t border-gray-200">
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100">
                    <Target className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Lead Source</p>
                    <p className="font-medium text-gray-900">
                      {LEAD_SOURCE_LABELS[leadInfo.lead_source]}
                    </p>
                  </div>
                </div>
                {leadInfo.lead_source_detail && (
                  <p className="text-sm text-gray-600 ml-13 pl-1">
                    {leadInfo.lead_source_detail}
                  </p>
                )}
                {leadInfo.lead_stage && (
                  <div className="mt-2">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${LEAD_STAGE_COLORS[leadInfo.lead_stage]}`}>
                      {LEAD_STAGE_LABELS[leadInfo.lead_stage]}
                    </span>
                  </div>
                )}
                {(leadInfo.utm_source || leadInfo.utm_campaign) && (
                  <div className="mt-2 text-xs text-gray-500">
                    {leadInfo.utm_source && <span className="mr-2">Source: {leadInfo.utm_source}</span>}
                    {leadInfo.utm_medium && <span className="mr-2">Medium: {leadInfo.utm_medium}</span>}
                    {leadInfo.utm_campaign && <span>Campaign: {leadInfo.utm_campaign}</span>}
                  </div>
                )}
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
                  const wellInfo = null; // TODO: fetch from equipment API

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

      {/* Equipment Summary */}
      {!equipmentLoading && equipment.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-gray-400" />
                Equipment ({equipment.length})
              </CardTitle>
              {(expiringWarranties > 0 || expiredWarranties > 0) && (
                <Badge variant="warning">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {expiringWarranties + expiredWarranties} warranty alert{expiringWarranties + expiredWarranties > 1 ? 's' : ''}
                </Badge>
              )}
            </div>
            <Button variant="outline" size="sm" href={`/customers/${id}/equipment`}>
              View All
              <ChevronRight className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {equipment.slice(0, 6).map((item) => {
                const warrantyStatus = item.warranty_expires
                  ? differenceInDays(parseISO(item.warranty_expires), new Date()) < 0
                    ? 'expired'
                    : differenceInDays(parseISO(item.warranty_expires), new Date()) <= 30
                    ? 'expiring'
                    : 'valid'
                  : null;
                
                return (
                  <div
                    key={item.id}
                    className={`rounded-lg border p-3 ${
                      warrantyStatus === 'expired'
                        ? 'border-red-200 bg-red-50'
                        : warrantyStatus === 'expiring'
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{item.equipment_type}</p>
                    {(item.manufacturer || item.model) && (
                      <p className="text-sm text-gray-600">
                        {[item.manufacturer, item.model].filter(Boolean).join(' ')}
                      </p>
                    )}
                    {item.warranty_expires && (
                      <p className={`text-xs mt-1 ${
                        warrantyStatus === 'expired'
                          ? 'text-red-600'
                          : warrantyStatus === 'expiring'
                          ? 'text-amber-600'
                          : 'text-gray-500'
                      }`}>
                        Warranty: {format(parseISO(item.warranty_expires), 'MMM d, yyyy')}
                        {warrantyStatus === 'expired' && ' (Expired)'}
                        {warrantyStatus === 'expiring' && ' (Expiring soon)'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {equipment.length > 6 && (
              <p className="text-sm text-gray-500 mt-3 text-center">
                + {equipment.length - 6} more items
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Customer Notes */}
      <CustomerNotes customerId={id} />

      {/* Communication Timeline */}
      <CommunicationTimeline customerId={id} />

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
                // Property and assigned_user come from job API join
                const property = job.property;
                const assignedUser = job.assigned_user;

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
