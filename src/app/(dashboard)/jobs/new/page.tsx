'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { JobForm } from '@/components/scheduling/JobForm';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

function JobFormContent() {
  const searchParams = useSearchParams();
  const fromQuote = searchParams.get('from_quote');
  const customerId = searchParams.get('customer_id');
  const customerName = searchParams.get('customer_name');
  const address = searchParams.get('address');
  const city = searchParams.get('city');
  const serviceType = searchParams.get('service_type');
  const notes = searchParams.get('notes');
  const requestId = searchParams.get('request_id');
  
  const [initialData, setInitialData] = useState<any>(null);
  const [loading, setLoading] = useState(!!fromQuote);

  useEffect(() => {
    // If coming from a quote, fetch quote data
    if (fromQuote) {
      fetchQuoteData(fromQuote);
    } else if (customerId || customerName) {
      // Coming from a request
      setInitialData({
        customer_id: customerId,
        customer_name: customerName,
        address: address,
        city: city,
        job_type: serviceType,
        description: notes,
        request_id: requestId,
      });
    }
  }, [fromQuote, customerId, customerName, address, city, serviceType, notes, requestId]);

  const fetchQuoteData = async (quoteId: string) => {
    try {
      const res = await fetch(`/api/quotes/${quoteId}`);
      if (res.ok) {
        const data = await res.json();
        const quote = data.quote;
        
        // Build description from quote items
        const itemsDescription = quote.items
          ?.map((item: any) => `- ${item.description}: $${item.unit_price}${item.quantity > 1 ? ` x${item.quantity}` : ''}`)
          .join('\n') || '';
        
        setInitialData({
          customer_id: quote.customer_id,
          property_id: quote.property_id,
          job_type: quote.items?.[0]?.description || 'Service',
          description: `From Quote #${quote.quote_number}\n\n${itemsDescription}`,
          notes: quote.notes,
          quote_id: quoteId,
          // Pre-fill address from quote
          address: quote.service_address || quote.customer?.billing_address,
        });
      }
    } catch (error) {
      console.error('Failed to fetch quote:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-gray-400" />
        <p className="mt-2 text-gray-500">Loading quote data...</p>
      </div>
    );
  }

  return <JobForm mode="create" initialData={initialData} />;
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
