'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DollarSign,
  Users,
  TrendingUp,
  TrendingDown,
  Briefcase,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Calendar,
  Wrench,
  Truck,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from 'recharts';
import { format, subMonths, startOfMonth, parseISO } from 'date-fns';

const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#8B5CF6', '#EF4444', '#EC4899', '#06B6D4'];

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  hourly_rate: number | null;
  tech_type: string | null;
}

interface PerformanceData {
  teamMember: TeamMember;
  visits: number;
  uniqueJobs: number;
  revenue: number;
  partsRevenue: number;
  laborRevenue: number;
  daysWorked: number;
  revenuePerDay: number;
  visitsPerDay: number;
  avgTicket: number;
  laborCost: number;
  partsCost: number;
  truckCost: number;
  totalCost: number;
  profit: number;
  margin: number;
  crewType: 'solo' | 'two_man' | 'mixed';
}

interface SummaryData {
  totalRevenue: number;
  totalVisits: number;
  totalProfit: number;
  avgMargin: number;
  avgTicket: number;
  techCount: number;
  soloJobs: number;
  twoManJobs: number;
}

type DateRangeOption = 'month' | 'last3' | 'last6' | 'year' | 'all';

export default function TeamPerformancePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeOption>('month');
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [performance, setPerformance] = useState<PerformanceData[]>([]);
  const [expandedTech, setExpandedTech] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'revenue' | 'margin' | 'visits'>('revenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Generate month options for selector
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'MMMM yyyy'),
    };
  });

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      
      if (dateRange === 'month') {
        params.set('month', selectedMonth);
      } else if (dateRange === 'last3') {
        const start = format(subMonths(new Date(), 3), 'yyyy-MM-dd');
        const end = format(new Date(), 'yyyy-MM-dd');
        params.set('start_date', start);
        params.set('end_date', end);
      } else if (dateRange === 'last6') {
        const start = format(subMonths(new Date(), 6), 'yyyy-MM-dd');
        const end = format(new Date(), 'yyyy-MM-dd');
        params.set('start_date', start);
        params.set('end_date', end);
      } else if (dateRange === 'year') {
        const start = format(subMonths(new Date(), 12), 'yyyy-MM-dd');
        const end = format(new Date(), 'yyyy-MM-dd');
        params.set('start_date', start);
        params.set('end_date', end);
      }
      // 'all' - no params = all time

      const res = await fetch(`/api/team-performance?${params}`);
      if (!res.ok) {
        throw new Error('Failed to fetch performance data');
      }

      const data = await res.json();
      setSummary(data.summary);
      setPerformance(data.performance);
    } catch (err) {
      console.error('Error fetching performance:', err);
      setError('Failed to load performance data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dateRange, selectedMonth]);

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const res = await fetch('/api/team-performance/recalc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months: 12 }),
      });
      
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error('Recalc error:', err);
    } finally {
      setRecalculating(false);
    }
  };

  const handleSort = (field: 'revenue' | 'margin' | 'visits') => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortedPerformance = [...performance].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortField) {
      case 'revenue':
        return (b.revenue - a.revenue) * dir;
      case 'margin':
        return (b.margin - a.margin) * dir;
      case 'visits':
        return (b.visits - a.visits) * dir;
      default:
        return 0;
    }
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  const getMarginColor = (margin: number) => {
    if (margin >= 45) return 'text-green-600 bg-green-100';
    if (margin >= 30) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  const getTechTypeLabel = (type: string | null) => {
    switch (type) {
      case 'service': return 'Service';
      case 'pump_lead': return 'Pump Lead';
      case 'mixed': return 'Mixed';
      case 'driller': return 'Driller';
      case 'helper': return 'Helper';
      default: return type || 'Unknown';
    }
  };

  // Chart data
  const revenueChartData = sortedPerformance.slice(0, 8).map(p => ({
    name: p.teamMember.name.split(' ')[0],
    revenue: p.revenue,
    profit: p.profit,
    fullName: p.teamMember.name,
  }));

  const crewTypeData = [
    { name: 'Solo', value: summary?.soloJobs || 0, color: '#10B981' },
    { name: 'Two-Man', value: summary?.twoManJobs || 0, color: '#3B82F6' },
  ].filter(d => d.value > 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-600">{error}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Team Performance</h2>
          <p className="text-gray-600">Track tech revenue, margins, and crew economics</p>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Date Range Selector */}
          <div className="flex items-center gap-2 bg-white rounded-lg border p-1">
            {(['month', 'last3', 'last6', 'year', 'all'] as DateRangeOption[]).map((range) => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  dateRange === range
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {range === 'month' ? 'Month' : 
                 range === 'last3' ? '3M' :
                 range === 'last6' ? '6M' :
                 range === 'year' ? '1Y' : 'All'}
              </button>
            ))}
          </div>

          {/* Month Selector (only visible when dateRange is 'month') */}
          {dateRange === 'month' && (
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}

          {/* Recalculate Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRecalculate}
            disabled={recalculating}
          >
            <RefreshCw className={`h-4 w-4 ${recalculating ? 'animate-spin' : ''}`} />
            {recalculating ? 'Recalculating...' : 'Recalculate'}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-green-100 p-3">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(summary?.totalRevenue || 0)}
              </p>
              <p className="text-sm text-gray-600">Total Revenue</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className={`rounded-lg p-3 ${getMarginColor(summary?.avgMargin || 0)}`}>
                <TrendingUp className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold text-gray-900">
                {formatPercent(summary?.avgMargin || 0)}
              </p>
              <p className="text-sm text-gray-600">Average Margin</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-blue-100 p-3">
                <Briefcase className="h-5 w-5 text-blue-600" />
              </div>
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold text-gray-900">
                {summary?.totalVisits || 0}
              </p>
              <p className="text-sm text-gray-600">Total Visits</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-purple-100 p-3">
                <DollarSign className="h-5 w-5 text-purple-600" />
              </div>
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(summary?.avgTicket || 0)}
              </p>
              <p className="text-sm text-gray-600">Avg Ticket</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue by Tech Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Tech</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {revenueChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis type="number" tickFormatter={(v) => `$${v / 1000}k`} />
                    <YAxis dataKey="name" type="category" width={70} />
                    <Tooltip
                      formatter={(value) => [formatCurrency(value as number), 'Revenue']}
                      labelFormatter={(_, payload: any) => payload?.[0]?.payload?.fullName || ''}
                    />
                    <Bar dataKey="revenue" fill="#10B981" radius={[0, 4, 4, 0]} name="Revenue" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  No data for this period
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Crew Type Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Crew Economics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center">
              {crewTypeData.length > 0 ? (
                <div className="flex items-center gap-8">
                  <ResponsiveContainer width={200} height={200}>
                    <PieChart>
                      <Pie
                        data={crewTypeData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {crewTypeData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-3">
                    {crewTypeData.map((entry, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-sm text-gray-600">
                          {entry.name}: {entry.value} jobs
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-gray-500">No data for this period</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team Performance Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Tech Performance Details</CardTitle>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>Color coding:</span>
            <span className="px-2 py-0.5 rounded bg-green-100 text-green-700">&gt;45%</span>
            <span className="px-2 py-0.5 rounded bg-yellow-100 text-yellow-700">30-45%</span>
            <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">&lt;30%</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 font-medium text-gray-600">Tech</th>
                  <th className="text-left py-3 font-medium text-gray-600">Role</th>
                  <th className="text-center py-3 font-medium text-gray-600">Rate</th>
                  <th 
                    className="text-center py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                    onClick={() => handleSort('visits')}
                  >
                    Visits {sortField === 'visits' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th 
                    className="text-right py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                    onClick={() => handleSort('revenue')}
                  >
                    Revenue {sortField === 'revenue' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="text-center py-3 font-medium text-gray-600">Rev/Day</th>
                  <th className="text-center py-3 font-medium text-gray-600">Avg Ticket</th>
                  <th 
                    className="text-center py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                    onClick={() => handleSort('margin')}
                  >
                    Margin {sortField === 'margin' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="text-right py-3 font-medium text-gray-600">Profit</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {sortedPerformance.length > 0 ? (
                  sortedPerformance.map((perf) => (
                    <>
                      <tr 
                        key={perf.teamMember.id} 
                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                        onClick={() => setExpandedTech(
                          expandedTech === perf.teamMember.id ? null : perf.teamMember.id
                        )}
                      >
                        <td className="py-3">
                          <div className="font-medium text-gray-900">{perf.teamMember.name}</div>
                        </td>
                        <td className="py-3">
                          <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700">
                            {getTechTypeLabel(perf.teamMember.tech_type)}
                          </span>
                        </td>
                        <td className="py-3 text-center text-gray-600">
                          ${perf.teamMember.hourly_rate || '-'}/hr
                        </td>
                        <td className="py-3 text-center text-gray-900">{perf.visits}</td>
                        <td className="py-3 text-right font-medium text-gray-900">
                          {formatCurrency(perf.revenue)}
                        </td>
                        <td className="py-3 text-center text-gray-600">
                          {formatCurrency(perf.revenuePerDay)}
                        </td>
                        <td className="py-3 text-center text-gray-600">
                          {formatCurrency(perf.avgTicket)}
                        </td>
                        <td className="py-3 text-center">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getMarginColor(perf.margin)}`}>
                            {formatPercent(perf.margin)}
                          </span>
                        </td>
                        <td className={`py-3 text-right font-medium ${perf.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(perf.profit)}
                        </td>
                        <td className="py-3">
                          {expandedTech === perf.teamMember.id ? (
                            <ChevronUp className="h-4 w-4 text-gray-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                          )}
                        </td>
                      </tr>
                      
                      {/* Expanded Details Row */}
                      {expandedTech === perf.teamMember.id && (
                        <tr className="bg-gray-50">
                          <td colSpan={10} className="py-4 px-6">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <div className="p-3 bg-white rounded-lg border">
                                <p className="text-xs text-gray-500">Days Worked</p>
                                <p className="text-lg font-semibold">{perf.daysWorked}</p>
                              </div>
                              <div className="p-3 bg-white rounded-lg border">
                                <p className="text-xs text-gray-500">Visits/Day</p>
                                <p className="text-lg font-semibold">{perf.visitsPerDay.toFixed(1)}</p>
                              </div>
                              <div className="p-3 bg-white rounded-lg border">
                                <p className="text-xs text-gray-500">Labor Revenue</p>
                                <p className="text-lg font-semibold">{formatCurrency(perf.laborRevenue)}</p>
                              </div>
                              <div className="p-3 bg-white rounded-lg border">
                                <p className="text-xs text-gray-500">Parts Revenue</p>
                                <p className="text-lg font-semibold">{formatCurrency(perf.partsRevenue)}</p>
                              </div>
                              <div className="p-3 bg-white rounded-lg border">
                                <p className="text-xs text-gray-500">Labor Cost</p>
                                <p className="text-lg font-semibold text-orange-600">{formatCurrency(perf.laborCost)}</p>
                              </div>
                              <div className="p-3 bg-white rounded-lg border">
                                <p className="text-xs text-gray-500">Parts Cost (50%)</p>
                                <p className="text-lg font-semibold text-orange-600">{formatCurrency(perf.partsCost)}</p>
                              </div>
                              <div className="p-3 bg-white rounded-lg border">
                                <p className="text-xs text-gray-500">Truck Cost</p>
                                <p className="text-lg font-semibold text-orange-600">{formatCurrency(perf.truckCost)}</p>
                              </div>
                              <div className="p-3 bg-white rounded-lg border">
                                <p className="text-xs text-gray-500">Crew Type</p>
                                <p className="text-lg font-semibold capitalize">{perf.crewType.replace('_', ' ')}</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-gray-500">
                      No performance data for this period
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
