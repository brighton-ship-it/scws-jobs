'use client';

import { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Input } from '@/components/forms/Input';
import { Select } from '@/components/forms/Select';
import { GripVertical, Trash2, Package, Plus, Receipt } from 'lucide-react';
import type { LineItemType, Product } from '@/types/database';
import { Search } from 'lucide-react';

// Searchable Product Picker Component
function ProductPicker({ 
  products, 
  onSelect, 
  onClose,
  initialSearch = ''
}: { 
  products: Product[];
  onSelect: (productId: string) => void;
  onClose: () => void;
  initialSearch?: string;
}) {
  const [search, setSearch] = useState(initialSearch);
  
  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.description?.toLowerCase().includes(search.toLowerCase()))
  );
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };
  
  return (
    <>
      <div
        className="fixed inset-0 z-10"
        onClick={onClose}
      />
      <div className="absolute top-full left-0 mt-1 z-20 w-96 rounded-lg border border-gray-200 bg-white shadow-lg">
        <div className="p-2 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-green-500 focus:border-transparent"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-64 overflow-auto">
          {filteredProducts.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">
              No products found
            </div>
          ) : (
            filteredProducts.slice(0, 50).map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => onSelect(product.id)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 flex justify-between items-center border-b border-gray-50 last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                  {product.description && (
                    <p className="text-xs text-gray-500 truncate">{product.description}</p>
                  )}
                  <p className="text-xs text-gray-400 capitalize">{product.item_type}</p>
                </div>
                <span className="text-sm font-medium text-gray-900 ml-2">
                  {formatCurrency(product.default_price)}
                </span>
              </button>
            ))
          )}
          {filteredProducts.length > 50 && (
            <div className="p-2 text-center text-xs text-gray-500 bg-gray-50">
              Showing 50 of {filteredProducts.length} — type to narrow results
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export interface LineItem {
  id: string;
  description: string;
  item_description: string | null;  // Extended description shown below the item name
  quantity: number;
  unit_price: number;
  total: number;
  item_type: LineItemType | null;
  taxable: boolean;  // Whether this item is subject to tax (default true)
  sort_order: number;
}

interface SortableItemProps {
  item: LineItem;
  onUpdate: (id: string, field: keyof LineItem, value: unknown) => void;
  onRemove: (id: string) => void;
  onProductSelect: (id: string) => void;
  showProductPicker: boolean;
  products: Product[];
  onProductPick: (itemId: string, productId: string) => void;
  onCloseProductPicker: () => void;
  canRemove: boolean;
}

const itemTypeOptions = [
  { value: '', label: 'Select type' },
  { value: 'labor', label: 'Labor' },
  { value: 'part', label: 'Part' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'service', label: 'Service' },
];

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

function SortableItem({
  item,
  onUpdate,
  onRemove,
  onProductSelect,
  showProductPicker,
  products,
  onProductPick,
  onCloseProductPicker,
  canRemove,
}: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto',
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      <div className={`p-3 bg-gray-50 rounded-lg ${isDragging ? 'shadow-lg ring-2 ring-blue-500' : ''}`}>
        {/* Main row */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
          {/* Drag handle */}
          <div
            {...attributes}
            {...listeners}
            className="hidden md:flex items-center justify-center col-span-1 pt-2 cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="h-5 w-5 text-gray-400" />
          </div>

          {/* Description with inline autocomplete */}
          <div className="col-span-1 md:col-span-4 relative">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  placeholder="Type to search products..."
                  value={item.description}
                  onChange={(e) => {
                    onUpdate(item.id, 'description', e.target.value);
                    // Auto-show picker when typing
                    if (e.target.value.length >= 2 && !showProductPicker) {
                      onProductSelect(item.id);
                    }
                  }}
                  onFocus={() => {
                    // Show picker on focus if there's text
                    if (item.description.length >= 2 && !showProductPicker) {
                      onProductSelect(item.id);
                    }
                  }}
                />
                {/* Inline autocomplete dropdown */}
                {showProductPicker && item.description.length >= 2 && (
                  <ProductPicker
                    products={products}
                    onSelect={(productId) => onProductPick(item.id, productId)}
                    onClose={onCloseProductPicker}
                    initialSearch={item.description}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => onProductSelect(item.id)}
                className="shrink-0 p-2 rounded-lg border border-gray-300 hover:bg-gray-100 text-gray-500"
                title="Browse all products"
              >
                <Package className="h-5 w-5" />
              </button>
            </div>

            {/* Full product picker (when clicking icon with no/short text) */}
            {showProductPicker && item.description.length < 2 && (
              <ProductPicker
                products={products}
                onSelect={(productId) => onProductPick(item.id, productId)}
                onClose={onCloseProductPicker}
              />
            )}
          </div>

          {/* Type */}
          <div className="col-span-1 md:col-span-2">
            <Select
              options={itemTypeOptions}
              value={item.item_type || ''}
              onChange={(e) => onUpdate(item.id, 'item_type', e.target.value || null)}
            />
          </div>

          {/* Quantity */}
          <div className="col-span-1 md:col-span-1">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={item.quantity}
              onChange={(e) => onUpdate(item.id, 'quantity', parseFloat(e.target.value) || 0)}
            />
          </div>

          {/* Unit Price */}
          <div className="col-span-1 md:col-span-2">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={item.unit_price}
              onChange={(e) => onUpdate(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
              leftIcon={<span className="text-gray-400">$</span>}
            />
          </div>

          {/* Total + Taxable indicator */}
          <div className="col-span-1 md:col-span-1 flex flex-col items-start gap-1">
            <span className="font-medium text-gray-900">{formatCurrency(item.total)}</span>
            {!item.taxable && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                <Receipt className="h-3 w-3" />
                Non-taxable
              </span>
            )}
          </div>

          {/* Remove */}
          <div className="col-span-1 md:col-span-1 flex items-center justify-end">
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              disabled={!canRemove}
              className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Description textarea row */}
        <div className="mt-2 grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="col-span-1 hidden md:block"></div>
          <div className="col-span-1 md:col-span-6">
            <textarea
              placeholder="Add details or description for this item (optional)"
              value={item.item_description || ''}
              onChange={(e) => onUpdate(item.id, 'item_description', e.target.value || null)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
          <div className="col-span-1 md:col-span-5 flex items-center">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={item.taxable}
                onChange={(e) => onUpdate(item.id, 'taxable', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">Taxable</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

interface DraggableLineItemsProps {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  products: Product[];
}

export function DraggableLineItems({ items, onChange, products }: DraggableLineItemsProps) {
  const [showProductPicker, setShowProductPicker] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);

        const newItems = arrayMove(items, oldIndex, newIndex).map((item, idx) => ({
          ...item,
          sort_order: idx,
        }));

        onChange(newItems);
      }
    },
    [items, onChange]
  );

  const addLineItem = () => {
    const newItem: LineItem = {
      id: Date.now().toString(),
      description: '',
      item_description: null,
      quantity: 1,
      unit_price: 0,
      total: 0,
      item_type: null,
      taxable: true,
      sort_order: items.length,
    };
    onChange([...items, newItem]);
  };

  const updateLineItem = (id: string, field: keyof LineItem, value: unknown) => {
    onChange(
      items.map((item) => {
        if (item.id !== id) return item;

        const updated = { ...item, [field]: value };

        // Recalculate total when quantity or unit_price changes
        if (field === 'quantity' || field === 'unit_price') {
          updated.total = Number(updated.quantity) * Number(updated.unit_price);
        }

        // Labor is not taxable in California - auto-set when type changes
        if (field === 'item_type') {
          updated.taxable = value !== 'labor';
        }

        return updated;
      })
    );
  };

  const removeLineItem = (id: string) => {
    if (items.length === 1) return;
    onChange(items.filter((item) => item.id !== id));
  };

  const addProductToLineItem = (itemId: string, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    onChange(
      items.map((item) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          description: product.name,
          item_description: product.description || null,
          unit_price: product.default_price,
          total: item.quantity * product.default_price,
          item_type: product.item_type as LineItemType,
          // Labor is not taxable in California
          taxable: product.item_type !== 'labor',
        };
      })
    );
    setShowProductPicker(null);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="hidden md:grid md:grid-cols-12 gap-3 text-sm font-medium text-gray-500 px-2">
        <div className="col-span-1"></div>
        <div className="col-span-4">Description</div>
        <div className="col-span-2">Type</div>
        <div className="col-span-1">Qty</div>
        <div className="col-span-2">Unit Price</div>
        <div className="col-span-1">Total</div>
        <div className="col-span-1"></div>
      </div>

      {/* Sortable Items */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <SortableItem
              key={item.id}
              item={item}
              onUpdate={updateLineItem}
              onRemove={removeLineItem}
              onProductSelect={(id) => setShowProductPicker(showProductPicker === id ? null : id)}
              showProductPicker={showProductPicker === item.id}
              products={products}
              onProductPick={addProductToLineItem}
              onCloseProductPicker={() => setShowProductPicker(null)}
              canRemove={items.length > 1}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Add Item Button */}
      <button
        type="button"
        onClick={addLineItem}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add Line Item
      </button>
    </div>
  );
}
