import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const dynamic = 'force-dynamic';

// In-memory cache for product details (1 hour TTL)
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Ramona Home Depot store ID
const RAMONA_STORE_ID = '6341'; // Placeholder - need to verify

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

interface ProductDetails {
  productId: string;
  name: string;
  price: number | null;
  modelNumber: string | null;
  upc: string | null;
  brand: string | null;
  description: string | null;
  specs: Record<string, string>;
  stockStatus: string;
  stockQuantity: number | null;
  imageUrls: string[];
  productUrl: string;
}

async function scrapeProductDetails(productId: string, storeId: string, retries = 3): Promise<ProductDetails | null> {
  const cacheKey = `product:${productId}:${storeId}`;
  
  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('Returning cached product details for:', productId);
    return cached.data;
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Home Depot product URL pattern
      const url = `https://www.homedepot.com/p/${productId}?storeSelection=${storeId}`;
      
      console.log(`Scraping product details (attempt ${attempt + 1}):`, url);

      const response = await fetch(url, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Extract product name
      const name = $('h1.product-details__title, [data-testid="product-title"]').text().trim();
      if (!name) {
        throw new Error('Product not found');
      }

      // Extract price
      const priceText = $('.price-format__main-price, [data-testid="price-format__main-price"]').first().text().trim();
      const price = priceText ? parseFloat(priceText.replace(/[^0-9.]/g, '')) : null;

      // Extract model number
      const modelNumber = $('[data-testid="product-model"] .sui-text-base, .product-info-bar__detail--model').text().trim() || null;

      // Extract UPC
      const upc = $('[data-testid="product-sku"], .product-info-bar__detail--sku').text().replace(/[^0-9]/g, '') || null;

      // Extract brand
      const brand = $('[data-testid="product-brand"], .product-details__brand a').text().trim() || null;

      // Extract description
      const description = $('.product-details__description, [data-testid="product-description"]').text().trim() || null;

      // Extract specs
      const specs: Record<string, string> = {};
      $('.specification-list__item, [data-testid="specification-item"]').each((i, elem) => {
        const label = $(elem).find('.specification-list__label, [data-testid="spec-label"]').text().trim();
        const value = $(elem).find('.specification-list__value, [data-testid="spec-value"]').text().trim();
        if (label && value) {
          specs[label] = value;
        }
      });

      // Extract stock status and quantity
      let stockStatus = 'Unknown';
      let stockQuantity: number | null = null;
      
      const fulfillmentText = $('.fulfillment__text, [data-testid="fulfillment-text"]').text().trim().toLowerCase();
      const quantityText = $('.fulfillment__quantity, [data-testid="stock-quantity"]').text().trim();
      
      if (quantityText) {
        const match = quantityText.match(/(\d+)/);
        if (match) {
          stockQuantity = parseInt(match[1]);
        }
      }

      if (fulfillmentText.includes('in stock') || fulfillmentText.includes('available')) {
        stockStatus = 'In Stock';
      } else if (fulfillmentText.includes('out of stock') || fulfillmentText.includes('unavailable')) {
        stockStatus = 'Out of Stock';
        stockQuantity = 0;
      } else if (fulfillmentText.includes('limited')) {
        stockStatus = 'Limited Stock';
      }

      // Extract images
      const imageUrls: string[] = [];
      $('img[data-media-type="image"], .product-image__img').each((i, elem) => {
        const src = $(elem).attr('src') || $(elem).attr('data-lazy');
        if (src && !src.includes('placeholder')) {
          // Get higher resolution image if available
          const highResSrc = src.replace(/\$\d+\$/, '$1000$');
          if (!imageUrls.includes(highResSrc)) {
            imageUrls.push(highResSrc);
          }
        }
      });

      const productDetails: ProductDetails = {
        productId,
        name,
        price,
        modelNumber,
        upc,
        brand,
        description,
        specs,
        stockStatus,
        stockQuantity,
        imageUrls,
        productUrl: url.split('?')[0], // Remove query params
      };

      // Cache the results
      cache.set(cacheKey, { data: productDetails, timestamp: Date.now() });
      console.log('Product details scraped successfully');
      
      return productDetails;
    } catch (error) {
      console.error(`Scrape attempt ${attempt + 1} failed:`, error);
      
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      } else {
        throw error;
      }
    }
  }

  return null;
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('storeId') || RAMONA_STORE_ID;
    const productId = params.id;

    if (!productId) {
      return NextResponse.json(
        { error: 'Product ID is required' },
        { status: 400 }
      );
    }

    const productDetails = await scrapeProductDetails(productId, storeId);

    if (!productDetails) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      product: productDetails,
    });
  } catch (error) {
    console.error('Home Depot product API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch product details',
      },
      { status: 500 }
    );
  }
}
