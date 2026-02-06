'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Button } from '@/components/forms/Button';
import { Input } from '@/components/ui/input';
import {
  Users,
  TrendingUp,
  DollarSign,
  Target,
  Calendar,
  Loader2,
  ChevronRight,
  Search as SearchIcon,
} from 'lucide-react';
import { format, subDays, subMonths, startOfMonth } from 'date-fns';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  FunnelChart,
  Funnel,
  LabelList,
} from 'recharts';
import Link from 'next/link';
import type { LeadSource } from '@/types/database';

type Period = '7d' | '30d' | '90d' | '12m' | 'all';

interface LeadSourceStats {
  lead_source: LeadSource;
  total_leads: number;
  quotes_sent: number;
  quotes_accepted: number;
  jobs_scheduled: number;
  jobs_completed: number;
  paid: number;
  total_revenue: number;
  conversion_rate: number;
}

interface RecentLead {
  id: string;
  name: string;
  lead_source: LeadSource;
  lead_stage: string;
  created_at: string;
}

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

const LEAD_SOURCE_COLORS: Record<LeadSource, string> = {
  google_ads: '#4285F4',
  organic_seo: '#34A853',
  referral: '#FBBC05',
  repeat_customer: '#EA4335',
  phone: '#9333EA',
  walk_in: '#F97316',
  website_form: '#06B6D4',
  other: '#6B7280',
};

const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  quote_sent: 'Quote Sent',
  quote_accepted: 'Quote Accepted',
  job_scheduled: 'Job Scheduled',
  job_completed: 'Job Completed',
  paid: 'Paid',
};

export default function LeadReportsPage() {
  const [period, setPeriod] = useState<Period>('30d');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<LeadSourceStats[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [recentLeads, setRecentLeads] = useState<RecentLead[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<any[]>([]);
  const [costsBySource, setCostsBySource] = useState<Record<string, number>>({});
  const [editingCost, setEditingCost] = useState<string | null>(null);
  const [costValue, setCostValue] = useState('');

  // Calculate date range
  const getDateRange = () => {
    const end = new Date();
    let start: Date | null = null;

    switch (period) {
      case '7d':
        start = subDays(end, 7);
        break;
      case '30d':
        start = subDays(end, 30);
        break;
      case '90d':
        start = subDays(end, 90);
        break;
      case '12m':
        start = subMonths(end, 12);
        break;
      case 'all':
        start = null;
        break;
    }

    return { start, end };
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange();
      const params = new URLSearchParams();
      if (start) params.set('start_date', start.toISOString());
      params.set('end_date', end.toISOString());

      const res = await fetch(`/api/reports/leads?${params}`);
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats_by_source || []);
        setTotals(data.totals || {});
        setRecentLeads(data.recent_leads || []);
        setMonthlyTrend(data.monthly_trend || []);
        setCostsBySource(data.costs_by_source || {});
      }
    } catch (err) {
      console.error('Failed to fetch lead data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [period]);

  const saveCost = async (source: LeadSource) => {
    try {
      const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
      await fetch('/api/reports/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_source: source,
          month: monthStart,
          cost: parseFloat(costValue) || 0,
        }),
      });
      setEditingCost(null);
      fetchData();
    } catch (err) {
      console.error('Failed to save cost:', err);
    }
  };

  // Prepare pie chart data
  const pieData = stats.map((s) => ({
    name: LEAD_SOURCE_LABELS[s.lead_source],
    value: s.total_leads,
    color: LEAD_SOURCE_COLORS[s.lead_source],
  }));

  // Prepare funnel data
  const funnelData = [
    { name: 'Leads', value: totals.total_leads || 0, fill: '#3B82F6' },
    { name: 'Quotes Sent', value: totals.quotes_sent || 0, fill: '#8B5CF6' },
    { name: 'Quotes Accepted', value: totals.quotes_accepted || 0, fill: '#F59E0B' },
    { name: 'Jobs Completed', value: totals.jobs_completed || 0, fill: '#10B981' },
    { name: 'Paid', value: totals.paid || 0, fill: '#059669' },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Reports', href: '/reports' },
          { label: 'Lead Sources' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Lead Source Report</h2>
          <p className="text-gray-600">Track where your leads come from and measure ROI</p>
        </div>
        <div className="flex gap-2">
          {(['7d', '30d', '90d', '12m', 'all'] as Period[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setPeriod(p)}
            >
              {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : p === '90d' ? '90 Days' : p === '12m' ? '12 Months' : 'All Time'}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading lead data...</span>
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-100 p-2">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Leads</p>
                    <p className="text-2xl font-bold text-gray-900">{totals.total_leads || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-green-100 p-2">
                    <Target className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Converted (Paid)</p>
                    <p className="text-2xl font-bold text-gray-900">{totals.paid || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-purple-100 p-2">
                    <TrendingUp className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Conversion Rate</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {totals.total_leads > 0 
                        ? Math.round((totals.paid / totals.total_leads) * 100) 
                        : 0}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-orange-100 p-2">
                    <DollarSign className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Revenue</p>
                    <p className="text-2xl font-bold text-gray-900">
                      ${(totals.total_revenue || 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Lead Sources Pie Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Leads by Source</CardTitle>
              </CardHeader>
              <CardContent>
                {pieData.length > 0 ? (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-80 flex items-center justify-center text-gray-500">
                    No lead data available for this period
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Conversion Funnel */}
            <Card>
              <CardHeader>
                <CardTitle>Conversion Funnel</CardTitle>
              </CardHeader>
              <CardContent>
                {totals.total_leads > 0 ? (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        layout="vertical"
                        data={funnelData}
                        margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis dataKey="name" type="category" width={120} />
                        <Tooltip />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {funnelData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-80 flex items-center justify-center text-gray-500">
                    No data for funnel
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Source Performance Table */}
          <Card>
            <CardHeader>
              <CardTitle>Performance by Source</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Source</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Leads</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Quotes</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Jobs</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Paid</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Conv. Rate</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Revenue</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Cost</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((row) => {
                      const cost = costsBySource[row.lead_source] || 0;
                      const roi = cost > 0 ? Math.round(((row.total_revenue - cost) / cost) * 100) : null;
                      
                      return (
                        <tr key={row.lead_source} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div
                                className="h-3 w-3 rounded-full"
                                style={{ backgroundColor: LEAD_SOURCE_COLORS[row.lead_source] }}
                              />
                              <span className="font-medium text-gray-900">
                                {LEAD_SOURCE_LABELS[row.lead_source]}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-900">{row.total_leads}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{row.quotes_sent}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{row.jobs_completed}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{row.paid}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={row.conversion_rate >= 50 ? 'text-green-600' : row.conversion_rate >= 25 ? 'text-yellow-600' : 'text-gray-600'}>
                              {row.conversion_rate}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900">
                            ${row.total_revenue.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {editingCost === row.lead_source ? (
                              <div className="flex items-center gap-1 justify-end">
                                <span className="text-gray-500">$</span>
                                <input
                                  type="number"
                                  className="w-20 px-2 py-1 border rounded text-sm"
                                  value={costValue}
                                  onChange={(e) => setCostValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveCost(row.lead_source);
                                    if (e.key === 'Escape') setEditingCost(null);
                                  }}
                                  autoFocus
                                />
                                <button
                                  onClick={() => saveCost(row.lead_source)}
                                  className="text-green-600 hover:text-green-800 text-xs"
                                >
                                  Save
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingCost(row.lead_source);
                                  setCostValue(cost.toString());
                                }}
                                className="text-gray-600 hover:text-blue-600"
                              >
                                ${cost.toLocaleString()}
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {roi !== null ? (
                              <span className={roi >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                                {roi >= 0 ? '+' : ''}{roi}%
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {stats.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                          No lead data available for this period
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Monthly Trend */}
          {monthlyTrend.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Monthly Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyTrend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      {Object.keys(LEAD_SOURCE_LABELS).map((source) => (
                        <Bar
                          key={source}
                          dataKey={source}
                          name={LEAD_SOURCE_LABELS[source as LeadSource]}
                          stackId="a"
                          fill={LEAD_SOURCE_COLORS[source as LeadSource]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Leads */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Leads</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {recentLeads.map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/customers/${lead.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: LEAD_SOURCE_COLORS[lead.lead_source] }}
                      />
                      <div>
                        <p className="font-medium text-gray-900">{lead.name}</p>
                        <p className="text-sm text-gray-500">
                          {LEAD_SOURCE_LABELS[lead.lead_source]} • {STAGE_LABELS[lead.lead_stage] || lead.lead_stage}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Calendar className="h-4 w-4" />
                      {format(new Date(lead.created_at), 'MMM d, yyyy')}
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    </div>
                  </Link>
                ))}
                {recentLeads.length === 0 && (
                  <p className="text-center text-gray-500 py-8">No recent leads</p>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
