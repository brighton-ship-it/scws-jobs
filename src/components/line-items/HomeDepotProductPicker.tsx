'use client';

import { useState, useEffect } from 'react';
import { Search, Loader2, Store, Package } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface HomeDepotProduct {
  name: string;
  price: number | null;
  modelNumber: string | null;
  stockStatus: string;
  stockQuantity: number | null;
  productUrl: string;
  imageUrl: string | null;
  productId: string;
  sku: string | null;
  brand: string | null;
}

interface Props {
  onSelect: (product: HomeDepotProduct, markup: number) => void;
  onClose: () => void;
  initialSearch?: string;
}

export function HomeDepotProductPicker({ onSelect, onClose, initialSearch = '' }: Props) {
  const [search, setSearch] = useState(initialSearch);
  const [products, setProducts] = useState<HomeDepotProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [markup, setMarkup] = useState(30); // Default 30% markup

  useEffect(() => {
    if (initialSearch && initialSearch.length >= 2) {
      searchHomeDepot(initialSearch);
    }
  }, []);

  const searchHomeDepot = async (query: string) => {
    if (!query || query.length < 2) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/homedepot/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        throw new Error('Search failed');
      }
      
      const data = await res.json();
      if (data.success) {
        setProducts(data.products || []);
        if (data.products.length === 0) {
          toast.info('No products found on Home Depot');
        }
      } else {
        toast.error(data.error || 'Failed to search Home Depot');
      }
    } catch (error) {
      console.error('Home Depot search error:', error);
      toast.error('Failed to search Home Depot');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    searchHomeDepot(search);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const calculatePrice = (cost: number) => {
    const markupMultiplier = 1 + (markup / 100);
    return cost * markupMultiplier;
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-10" onClick={onClose} />
      
      {/* Modal */}
      <div className="absolute top-full left-0 mt-1 z-20 w-[600px] max-w-[90vw] rounded-lg border border-gray-200 bg-white shadow-xl">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 bg-orange-50">
          <div className="flex items-center gap-2 mb-3">
            <Store className="h-5 w-5 text-orange-600" />
            <h3 className="font-semibold text-gray-900">Search Home Depot</h3>
          </div>
          
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search products (e.g., '1/2 PVC coupling')"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                autoFocus
              />
            </div>
            <Button type="submit" disabled={loading || search.length < 2}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
            </Button>
          </form>

          {/* Markup Control */}
          <div className="mt-3 flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Markup:</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                max="500"
                step="5"
                value={markup}
                onChange={(e) => setMarkup(Number(e.target.value))}
                className="w-20 text-right"
              />
              <span className="text-sm text-gray-600">%</span>
            </div>
            <span className="text-xs text-gray-500 ml-auto">
              Cost → Customer Price
            </span>
          </div>
        </div>

        {/* Results */}
        <div className="max-h-[500px] overflow-auto">
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="h-8 w-8 mx-auto animate-spin text-orange-600 mb-2" />
              <p className="text-sm text-gray-500">Searching Home Depot...</p>
            </div>
          ) : products.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Package className="h-12 w-12 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">
                {search.length < 2 
                  ? 'Enter at least 2 characters to search'
                  : 'No products found. Try a different search term.'
                }
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {products.map((product) => (
                <button
                  key={product.productId}
                  type="button"
                  onClick={() => onSelect(product, markup)}
                  className="w-full text-left p-3 hover:bg-orange-50 flex gap-3 items-start transition-colors"
                >
                  {/* Image */}
                  {product.imageUrl && (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="w-16 h-16 object-contain rounded border border-gray-200 flex-shrink-0"
                    />
                  )}
                  
                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 line-clamp-2">
                      {product.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {product.brand && (
                        <span className="text-xs text-gray-500">{product.brand}</span>
                      )}
                      {product.modelNumber && (
                        <span className="text-xs text-gray-400">
                          Model: {product.modelNumber}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        product.stockStatus === 'In Stock' 
                          ? 'bg-green-100 text-green-700'
                          : product.stockStatus === 'Limited Stock'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {product.stockStatus}
                        {product.stockQuantity !== null && product.stockQuantity > 0 && (
                          <span className="ml-1">({product.stockQuantity})</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Pricing */}
                  <div className="text-right flex-shrink-0">
                    {product.price !== null && (
                      <>
                        <div className="text-xs text-gray-500">Cost</div>
                        <div className="font-medium text-gray-700">
                          {formatCurrency(product.price)}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">→</div>
                        <div className="text-xs text-orange-600 font-medium">
                          {formatCurrency(calculatePrice(product.price))}
                        </div>
                      </>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {products.length > 0 && (
          <div className="p-3 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 text-center">
            Found {products.length} products · Prices and stock from HomeDepot.com
          </div>
        )}
      </div>
    </>
  );
}
