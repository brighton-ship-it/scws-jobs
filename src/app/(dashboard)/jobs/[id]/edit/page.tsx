'use client';


import { use } from 'react';
import { JobForm } from '@/components/scheduling/JobForm';
import { mockJobs } from '@/lib/mock-data';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

interface EditJobPageProps {
  params: Promise<{ id: string }>;
}

export default function EditJobPage({ params }: EditJobPageProps) {
  const resolvedParams = use(params);
  const job = mockJobs.find(j => j.id === resolvedParams.id);

  if (!job) {
    notFound();
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href={`/jobs/${resolvedParams.id}`}
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
