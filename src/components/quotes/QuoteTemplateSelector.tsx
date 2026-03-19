'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/forms/Input';
import { FileText, Zap } from 'lucide-react';
import type { QuoteTemplate } from '@/types/database';
import type { LineItem } from '@/components/line-items/DraggableLineItems';

interface QuoteTemplateSelectorProps {
  onApplyTemplate: (items: LineItem[], notes: string) => void;
}

function evaluateFormula(formula: string, variables: Record<string, number>): number {
  // Simple formula evaluator: supports 'depth', 'depth * 0.8', '1', etc.
  let expr = formula;
  for (const [key, val] of Object.entries(variables)) {
    expr = expr.replace(new RegExp(key, 'g'), val.toString());
  }
  try {
    // Safe eval for simple math expressions
    const result = Function('"use strict"; return (' + expr + ')')();
    return Math.round(result);
  } catch {
    return 0;
  }
}

export function QuoteTemplateSelector({ onApplyTemplate }: QuoteTemplateSelectorProps) {
  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<QuoteTemplate | null>(null);
  const [variables, setVariables] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/quote-templates')
      .then(r => r.json())
      .then(data => {
        setTemplates(data.templates || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSelectTemplate = (template: QuoteTemplate) => {
    setSelectedTemplate(template);
    // Initialize variables with defaults
    const defaults: Record<string, number> = {};
    for (const [key, config] of Object.entries(template.variables)) {
      defaults[key] = config.default;
    }
    setVariables(defaults);
  };

  const handleApply = () => {
    if (!selectedTemplate) return;

    const items: LineItem[] = selectedTemplate.line_items.map((tItem, index) => {
      const qty = evaluateFormula(tItem.quantity_formula, variables);
      return {
        id: Date.now().toString() + index,
        description: tItem.description,
        item_description: tItem.item_description,
        quantity: qty,
        unit_price: tItem.unit_price,
        unit_cost: tItem.unit_cost,
        total: qty * tItem.unit_price,
        item_type: tItem.item_type as LineItem['item_type'],
        taxable: tItem.taxable,
        sort_order: index,
      };
    });

    const depth = variables.depth || 500;
    const notes = `Proposal for drilling a ${depth}-foot air rotary water well lined with 4.5-inch SDR17 PVC liner. Estimated depth based on well logs from the surrounding area. This estimate pertains exclusively to the well drilling process.\n\nThis quote is valid for the next 30 days, after which values may be subject to change.`;

    onApplyTemplate(items, notes);
    setSelectedTemplate(null);
  };

  // Preview calculations
  const previewItems = selectedTemplate?.line_items.map(tItem => {
    const qty = evaluateFormula(tItem.quantity_formula, variables);
    return {
      description: tItem.description,
      qty,
      revenue: qty * tItem.unit_price,
      cost: qty * tItem.unit_cost,
      margin: tItem.unit_price > 0 ? ((tItem.unit_price - tItem.unit_cost) / tItem.unit_price * 100) : 0,
    };
  }) || [];

  const totalRevenue = previewItems.reduce((s, i) => s + i.revenue, 0);
  const totalCost = previewItems.reduce((s, i) => s + i.cost, 0);
  const totalMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100) : 0;

  if (loading) return null;
  if (templates.length === 0) return null;

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-blue-900">
          <Zap className="h-5 w-5" />
          Quick Quote Templates
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!selectedTemplate ? (
          <div className="flex flex-wrap gap-3">
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => handleSelectTemplate(t)}
                className="flex items-center gap-2 px-4 py-3 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 hover:border-blue-400 transition-colors"
              >
                <FileText className="h-4 w-4 text-blue-600" />
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-500">{t.description}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{selectedTemplate.name}</h3>
              <button
                onClick={() => setSelectedTemplate(null)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                ← Back
              </button>
            </div>

            {/* Variable Inputs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(selectedTemplate.variables).map(([key, config]) => (
                <Input
                  key={key}
                  label={config.label}
                  type="number"
                  min={config.min}
                  max={config.max}
                  value={variables[key] || config.default}
                  onChange={(e) => setVariables(prev => ({
                    ...prev,
                    [key]: parseInt(e.target.value) || config.default
                  }))}
                />
              ))}
            </div>

            {/* Preview Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Item</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">Qty</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">Revenue</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">Cost</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {previewItems.map((item, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-900">{item.description}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{item.qty}</td>
                      <td className="px-3 py-2 text-right text-gray-900">{fmt(item.revenue)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{fmt(item.cost)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${item.margin >= 50 ? 'text-green-600' : item.margin >= 35 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {item.margin.toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                  <tr>
                    <td className="px-3 py-2 text-gray-900">Total</td>
                    <td></td>
                    <td className="px-3 py-2 text-right text-gray-900">{fmt(totalRevenue)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmt(totalCost)}</td>
                    <td className={`px-3 py-2 text-right ${totalMargin >= 50 ? 'text-green-600' : totalMargin >= 35 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {totalMargin.toFixed(0)}%
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={2} className="px-3 py-2 text-gray-900">Gross Profit</td>
                    <td colSpan={3} className="px-3 py-2 text-right text-green-700 text-lg">
                      {fmt(totalRevenue - totalCost)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setSelectedTemplate(null)}>
                Cancel
              </Button>
              <Button onClick={handleApply}>
                Apply Template
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
