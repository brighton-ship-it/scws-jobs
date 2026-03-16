import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const dynamic = 'force-dynamic';

// In-memory cache for results (1 hour TTL)
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Mobile user agents for less aggressive bot detection
const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

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
  storeId?: string;
}

async function scrapeHomeDepot(query: string, storeId?: string, retries = 3): Promise<HomeDepotProduct[]> {
  const cacheKey = `${query}:${storeId || 'default'}`;
  
  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('Returning cached results for:', query);
    return cached.data;
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://www.homedepot.com/s/${encodedQuery}${storeId ? `?storeSelection=${storeId}` : ''}`;
      
      console.log(`Scraping Home Depot (attempt ${attempt + 1}):`, url);

      const response = await fetch(url, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        signal: AbortSignal.timeout(15000), // 15 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Extract Apollo State data (JSON embedded in page)
      let apolloState: any = null;
      
      $('script').each((i, elem) => {
        const content = $(elem).html() || '';
        if (content.includes('__APOLLO_STATE__')) {
          try {
            const match = content.match(/__APOLLO_STATE__\s*=\s*({.+?});/s);
            if (match) {
              apolloState = JSON.parse(match[1]);
              return false; // Stop iteration
            }
          } catch (e) {
            console.error('Failed to parse Apollo State:', e);
          }
        }
      });

      if (!apolloState) {
        throw new Error('No Apollo State found in page');
      }

      const products: HomeDepotProduct[] = [];
      
      // Find the main search query object
      const queryObj = Object.values(apolloState).find((obj: any) => 
        obj?.__typename === 'SearchModel'
      ) as any;

      if (!queryObj) {
        console.log('No SearchModel found in Apollo State');
        console.log('Available types:', Object.values(apolloState).slice(0, 5).map((obj: any) => obj?.__typename));
        return [];
      }

      // Get product references
      const productRefs = Object.entries(queryObj)
        .find(([key]) => key.startsWith('products('))?.[1] as any[];

      if (!productRefs || !Array.isArray(productRefs)) {
        console.log('No product references found in SearchModel');
        console.log('Available keys:', Object.keys(queryObj).slice(0, 10));
        return [];
      }

      // Extract each product
      for (const ref of productRefs) {
        try {
          const productKey = ref.__ref;
          const productData = apolloState[productKey];
          
          if (!productData) continue;

          const identifiers = productData.identifiers || {};
          const name = identifiers.productLabel || '';
          const productId = identifiers.itemId || '';
          const modelNumber = identifiers.modelNumber || null;
          const brand = identifiers.brandName || null;
          const sku = identifiers.storeSkuNumber || null;
          const canonicalUrl = identifiers.canonicalUrl || '';

          // Get pricing
          const pricingKey = Object.keys(productData).find(k => k.startsWith('pricing('));
          const pricing = pricingKey ? productData[pricingKey] : null;
          const price = pricing?.value || null;

          // Get fulfillment/stock info
          const fulfillmentKey = Object.keys(productData).find(k => k.startsWith('fulfillment('));
          const fulfillment = fulfillmentKey ? productData[fulfillmentKey] : null;
          
          let stockStatus = 'Unknown';
          let stockQuantity: number | null = null;

          if (fulfillment?.fulfillmentOptions) {
            const pickupOption = fulfillment.fulfillmentOptions.find((opt: any) => opt.type === 'pickup');
            if (pickupOption?.services?.[0]?.locations?.[0]?.inventory) {
              const inventory = pickupOption.services[0].locations[0].inventory;
              stockQuantity = inventory.quantity || null;
              
              if (inventory.isOutOfStock) {
                stockStatus = 'Out of Stock';
              } else if (inventory.isInStock) {
                stockStatus = 'In Stock';
              } else if (inventory.isLimitedQuantity) {
                stockStatus = 'Limited Stock';
              }
            }
          }

          // Get image
          const images = productData.media?.images || [];
          const primaryImage = images.find((img: any) => img.subType === 'PRIMARY') || images[0];
          const imageUrl = primaryImage?.url?.replace('<SIZE>', '400') || null;

          // Build product URL
          const productUrl = canonicalUrl 
            ? `https://www.homedepot.com${canonicalUrl}`
            : `https://www.homedepot.com/p/${productId}`;

          if (productId && name) {
            products.push({
              name,
              price,
              modelNumber,
              stockStatus,
              stockQuantity,
              productUrl,
              imageUrl,
              productId,
              sku,
              brand,
              storeId,
            });
          }
        } catch (err) {
          console.error('Error parsing product:', err);
        }
      }

      // If we got results, cache them
      if (products.length > 0) {
        cache.set(cacheKey, { data: products, timestamp: Date.now() });
        console.log(`Found ${products.length} products`);
        return products;
      }

      // If no products found on first attempt, try again
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
        continue;
      }

      return [];
    } catch (error) {
      console.error(`Scrape attempt ${attempt + 1} failed:`, error);
      
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
      } else {
        throw error;
      }
    }
  }

  return [];
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const storeId = searchParams.get('storeId');

    if (!query) {
      return NextResponse.json(
        { error: 'Missing required parameter: q' },
        { status: 400 }
      );
    }

    const products = await scrapeHomeDepot(query, storeId || undefined);

    return NextResponse.json({
      success: true,
      query,
      storeId: storeId || 'default',
      count: products.length,
      products,
    });
  } catch (error) {
    console.error('Home Depot API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search Home Depot',
      },
      { status: 500 }
    );
  }
}
