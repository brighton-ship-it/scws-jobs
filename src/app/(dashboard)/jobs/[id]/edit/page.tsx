'use client';

import { useParams } from 'next/navigation';
import { JobForm } from '@/components/scheduling/JobForm';
import { mockJobs } from '@/lib/mock-data';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function EditJobPage() {
  const params = useParams();
  const id = params.id as string;
  const job = mockJobs.find(j => j.id === id);

  if (!job) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Job not found</h2>
        <p className="text-gray-500 mt-2">The job you're looking for doesn't exist.</p>
        <Link href="/jobs" className="text-blue-600 hover:underline mt-4 inline-block">
          Back to Jobs
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/jobs"
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-gray-600" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Edit Job</h2>
          <p className="text-gray-600">
            {job.job_type} · Job #{job.id}
          </p>
        </div>
      </div>

      <JobForm job={job} mode="edit" />
    </div>
  );
}
