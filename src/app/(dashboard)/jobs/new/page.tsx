'use client';


import { Suspense } from 'react';
import { JobForm } from '@/components/scheduling/JobForm';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

function JobFormContent() {
  return <JobForm mode="create" />;
}

export default function NewJobPage() {
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
          <h2 className="text-2xl font-bold text-gray-900">Create New Job</h2>
          <p className="text-gray-600">Schedule a service job for a customer</p>
        </div>
      </div>

      <Suspense fallback={<div className="text-center py-8">Loading form...</div>}>
        <JobFormContent />
      </Suspense>
    </div>
  );
}
