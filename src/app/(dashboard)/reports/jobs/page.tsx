'use client';


import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { JobStatusBadge } from '@/components/ui/badge';
import { 
  Briefcase, 
  Clock, 
  CheckCircle,
  Users,
  Loader2,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

export default function JobsReportPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch data from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [jobsRes, usersRes] = await Promise.all([
          fetch('/api/jobs?limit=1000'),
          fetch('/api/users'),
        ]);
        if (jobsRes.ok) {
          const data = await jobsRes.json();
          setJobs(data.jobs || []);
        }
        if (usersRes.ok) {
          const data = await usersRes.json();
          setUsers(data.users || []);
        }
      } catch (err) {
        console.error('Failed to fetch report data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Calculate stats
  const totalJobs = jobs.length;
  const completedJobs = jobs.filter(j => j.status === 'completed' || j.status === 'invoiced').length;
  const inProgressJobs = jobs.filter(j => j.status === 'in_progress').length;
  const scheduledJobs = jobs.filter(j => j.status === 'scheduled').length;

  const completionRate = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;

  // Jobs by type
  const jobTypeCounts = jobs.reduce((acc, job) => {
    acc[job.job_type] = (acc[job.job_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const jobsByType = Object.entries(jobTypeCounts).map(([name, count], idx) => ({
    name,
    count,
    color: COLORS[idx % COLORS.length],
  }));

  // Jobs by status
  const jobsByStatus = [
    { name: 'Scheduled', value: scheduledJobs, color: '#3B82F6' },
    { name: 'In Progress', value: inProgressJobs, color: '#F59E0B' },
    { name: 'Completed', value: completedJobs, color: '#10B981' },
  ];

  // Jobs by crew member
  const fieldCrew = users.filter(u => u.role === 'field');
  const jobsByCrew = fieldCrew.map(user => {
    const assignedJobs = jobs.filter(j => j.assigned_to === user.id);
    const completed = assignedJobs.filter(j => j.status === 'completed' || j.status === 'invoiced').length;
    return {
      name: user.name.split(' ')[0],
      total: assignedJobs.length,
      completed,
      inProgress: assignedJobs.filter(j => j.status === 'in_progress').length,
    };
  });

  // Recent completed jobs
  const recentCompleted = [...jobs]
    .filter(j => j.status === 'completed' || j.status === 'invoiced')
    .sort((a, b) => {
      const dateA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
      const dateB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
      return dateB - dateA;
    })
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Reports', href: '/reports' },
          { label: 'Jobs' },
        ]}
      />

      <div>
        <h2 className="text-2xl font-bold text-gray-900">Jobs Report</h2>
        <p className="text-gray-600">Job performance and crew productivity</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-100 p-2">
                <Briefcase className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Jobs</p>
                <p className="text-xl font-bold text-gray-900">{totalJobs}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-100 p-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Completed</p>
                <p className="text-xl font-bold text-gray-900">{completedJobs}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-yellow-100 p-2">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">In Progress</p>
                <p className="text-xl font-bold text-gray-900">{inProgressJobs}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-100 p-2">
                <Users className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Completion Rate</p>
                <p className="text-xl font-bold text-gray-900">{completionRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Jobs by Type */}
        <Card>
          <CardHeader>
            <CardTitle>Jobs by Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={jobsByType}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {jobsByType.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Jobs by Status */}
        <Card>
          <CardHeader>
            <CardTitle>Jobs by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={jobsByStatus}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={80}
                    dataKey="value"
                  >
                    {jobsByStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Jobs by Crew Member */}
      <Card>
        <CardHeader>
          <CardTitle>Jobs by Crew Member</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={jobsByCrew}>
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="completed" stackId="a" fill="#10B981" name="Completed" radius={[0, 0, 0, 0]} />
                <Bar dataKey="inProgress" stackId="a" fill="#F59E0B" name="In Progress" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Recent Completed Jobs */}
      <Card>
        <CardHeader>
          <CardTitle>Recently Completed Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Job Type</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Customer</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Assigned To</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentCompleted.map((job) => {
                  // Property, customer, and assignee come from API join
                  const customer = job.property?.customer;
                  const assignee = job.assigned_user;
                  
                  return (
                    <tr key={job.id} className="border-b border-gray-100">
                      <td className="px-4 py-3 font-medium text-gray-900">{job.job_type}</td>
                      <td className="px-4 py-3 text-gray-600">{customer?.name || 'Unknown'}</td>
                      <td className="px-4 py-3 text-gray-600">{assignee?.name || 'Unassigned'}</td>
                      <td className="px-4 py-3">
                        <JobStatusBadge status={job.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
