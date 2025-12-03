/**
 * Price Fetcher Module
 * Fetches cryptocurrency prices from price feed URLs
 */

import axios from 'axios';

interface PriceData {
  price: number;
  timestamp: number;
}

/**
 * Fetch price from a price feed URL
 * Supports CoinGecko and other similar API formats
 */
export async function fetchPriceFromFeed(priceFeedUrl: string): Promise<PriceData> {
  try {
    const response = await axios.get(priceFeedUrl, { timeout: 10000 });
    
    // Parse different response formats
    let price: number | undefined;
    
    // CoinGecko format: { bitcoin: { usd: 104000 } } or { sui: { usd: 1.34 } }
    // Check for any coin ID key with usd property
    const coinKeys = Object.keys(response.data);
    for (const key of coinKeys) {
      if (response.data[key]?.usd && typeof response.data[key].usd === 'number') {
        price = response.data[key].usd;
        break;
      }
    }
    
    // Alternative format: { usd: 104000 }
    if (!price && response.data.usd && typeof response.data.usd === 'number') {
      price = response.data.usd;
    } 
    // Generic format: { price: 104000 }
    else if (!price && typeof response.data.price === 'number') {
      price = response.data.price;
    }
    
    if (!price || typeof price !== 'number') {
      throw new Error('Could not parse price from feed response');
    }
    
    return {
      price,
      timestamp: Date.now()
    };
    
  } catch (error: any) {
    if (error.response) {
      throw new Error(`Price feed error (${error.response.status}): ${error.message}`);
    } else if (error.request) {
      throw new Error('Price feed unreachable - network error');
    } else {
      throw new Error(`Price fetch failed: ${error.message}`);
    }
  }
}

/**
 * Validate price is within market range
 */
export function validatePrice(price: number, minValue: number, maxValue: number): boolean {
  return price >= minValue && price <= maxValue;
}

export { PriceData };
