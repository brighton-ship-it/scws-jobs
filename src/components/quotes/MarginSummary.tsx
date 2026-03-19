'use client';

import { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';
import type { LineItem } from '@/components/line-items/DraggableLineItems';

interface MarginSummaryProps {
  lineItems: LineItem[];
}

export function MarginSummary({ lineItems }: MarginSummaryProps) {
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  const stats = useMemo(() => {
    const itemsWithCost = lineItems.filter(i => i.unit_cost !== null && i.unit_cost !== undefined);
    if (itemsWithCost.length === 0) return null;

    const totalRevenue = itemsWithCost.reduce((s, i) => s + i.total, 0);
    const totalCost = itemsWithCost.reduce((s, i) => s + (i.unit_cost || 0) * i.quantity, 0);
    const grossProfit = totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? (grossProfit / totalRevenue * 100) : 0;

    // Items without cost data
    const uncovered = lineItems.filter(i => i.unit_cost === null || i.unit_cost === undefined);
    const uncoveredRevenue = uncovered.reduce((s, i) => s + i.total, 0);

    return { totalRevenue, totalCost, grossProfit, margin, uncoveredCount: uncovered.length, uncoveredRevenue };
  }, [lineItems]);

  if (!stats) return null;

  const marginColor = stats.margin >= 50 ? 'text-green-600' : stats.margin >= 35 ? 'text-yellow-600' : 'text-red-600';
  const marginBg = stats.margin >= 50 ? 'bg-green-50 border-green-200' : stats.margin >= 35 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200';

  return (
    <Card className={`${marginBg}`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <TrendingUp className="h-4 w-4" />
          Internal Margin Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase">Revenue</p>
            <p className="text-lg font-semibold text-gray-900">{fmt(stats.totalRevenue)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Est. Cost</p>
            <p className="text-lg font-semibold text-gray-500">{fmt(stats.totalCost)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Gross Profit</p>
            <p className="text-lg font-semibold text-green-700">{fmt(stats.grossProfit)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Margin</p>
            <p className={`text-2xl font-bold ${marginColor}`}>{stats.margin.toFixed(0)}%</p>
          </div>
        </div>
        {stats.uncoveredCount > 0 && (
          <p className="text-xs text-gray-400 mt-2">
            {stats.uncoveredCount} item(s) without cost data ({fmt(stats.uncoveredRevenue)}) not included in margin calc
          </p>
        )}
        <p className="text-xs text-gray-400 mt-1 italic">
          🔒 Internal only — not shown on customer quotes
        </p>
      </CardContent>
    </Card>
  );
}
