'use client';

import { use, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EquipmentList } from '@/components/equipment/EquipmentList';
import { ArrowLeft, User, Wrench } from 'lucide-react';
import type { Customer, Property, CustomerEquipment } from '@/types/database';

export default function CustomerEquipmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [equipment, setEquipment] = useState<CustomerEquipment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch customer data
        const customerRes = await fetch(`/api/customers/${id}`);
        if (customerRes.ok) {
          const customerData = await customerRes.json();
          setCustomer(customerData.customer);
          setProperties(customerData.customer?.properties || []);
        } else {
          // If customer API fails, set a minimal customer object
          setCustomer({ id, name: 'Customer' } as Customer);
        }

        // Fetch equipment - this might fail if table doesn't exist
        try {
          const equipmentRes = await fetch(`/api/customers/${id}/equipment`);
          if (equipmentRes.ok) {
            const equipmentData = await equipmentRes.json();
            setEquipment(equipmentData.equipment || []);
          }
        } catch {
          // Equipment fetch failed - might be missing table
          console.warn('Equipment fetch failed - table may not exist');
        }
      } catch (err) {
        console.error('Fetch error:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-lg text-gray-600">{error || 'Customer not found'}</p>
        <Button href="/customers" variant="outline" className="mt-4">
          <ArrowLeft className="h-4 w-4" />
          Back to Customers
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href={`/customers/${id}`} className="hover:text-emerald-600 flex items-center gap-1">
              <User className="h-4 w-4" />
              {customer.name}
            </Link>
            <span>/</span>
            <span className="flex items-center gap-1">
              <Wrench className="h-4 w-4" />
              Equipment
            </span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Equipment Tracking</h2>
          <p className="text-gray-600">Track pumps, motors, tanks, and other well equipment</p>
        </div>
      </div>

      {/* Equipment List */}
      <EquipmentList
        customerId={id}
        equipment={equipment}
        properties={properties}
        onEquipmentChange={setEquipment}
      />
    </div>
  );
}
