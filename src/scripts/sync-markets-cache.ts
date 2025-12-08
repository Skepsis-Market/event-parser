/**
 * Sync Markets Cache Script
 * Populates markets_cache collection from existing markets collection
 * Run this once after implementing the markets_cache feature
 */

import { MongoClient } from 'mongodb';
import CONFIG from '../config/env';

async function syncMarketsCache() {
  console.log('🔄 Starting markets_cache sync...\n');

  const client = new MongoClient(CONFIG.mongodbUri);
  await client.connect();
  const db = client.db(CONFIG.mongodbDb);

  try {
    // 1. Count existing markets
    const marketsCount = await db.collection('markets').countDocuments();
    console.log(`📊 Found ${marketsCount} markets to sync\n`);

    if (marketsCount === 0) {
      console.log('✅ No markets to sync');
      return;
    }

    // 2. Fetch all markets
    const markets = await db.collection('markets').find({}).toArray();

    let synced = 0;
    let errors = 0;

    // 3. Sync each market to cache
    for (const market of markets) {
      try {
        const marketConfig = market.configuration || {};
        const marketId = market.marketId || market.market_id;

        if (!marketId) {
          console.warn(`⚠️  Skipping market without ID:`, market._id);
          errors++;
          continue;
        }

        // Determine market status
        let status: 'ACTIVE' | 'RESOLVED' | 'CANCELLED' = 'ACTIVE';
        if (market.status === 'resolved' || market.resolved) {
          status = 'RESOLVED';
        } else if (market.status === 'cancelled' || market.cancelled) {
          status = 'CANCELLED';
        }

        // Extract market data with fallbacks
        const cacheData: any = {
          market_id: marketId,
          market_name: marketConfig.marketName || market.name || 'Unnamed Market',
          category: marketConfig.category || market.category || 'General',
          status: status,
          updated_at: new Date(),
        };

        // Add optional fields if available
        if (market.currentPrice !== undefined) {
          cacheData.current_price = market.currentPrice;
        }
        if (market.resolvedValue !== undefined || market.resolved_value !== undefined) {
          cacheData.resolved_value = market.resolvedValue || market.resolved_value;
        }
        if (marketConfig.minValue !== undefined) {
          cacheData.min_value = marketConfig.minValue;
        }
        if (marketConfig.maxValue !== undefined) {
          cacheData.max_value = marketConfig.maxValue;
        }
        if (marketConfig.bucketCount !== undefined) {
          cacheData.bucket_count = marketConfig.bucketCount;
        }
        if (marketConfig.bucketWidth !== undefined) {
          cacheData.bucket_width = marketConfig.bucketWidth;
        }
        if (market.resolutionTime !== undefined || marketConfig.resolutionTime !== undefined) {
          cacheData.resolution_time = market.resolutionTime || marketConfig.resolutionTime;
        }
        if (market.createdAt !== undefined) {
          cacheData.created_at = market.createdAt;
        }

        // Upsert into markets_cache
        await db.collection('markets_cache').updateOne(
          { market_id: marketId },
          { $set: cacheData },
          { upsert: true }
        );

        synced++;
        console.log(`✅ [${synced}/${marketsCount}] ${cacheData.market_name}`);
      } catch (error: any) {
        errors++;
        console.error(`❌ Error syncing market ${market._id}:`, error.message);
      }
    }

    // 4. Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Sync Summary:`);
    console.log(`   Total markets: ${marketsCount}`);
    console.log(`   Successfully synced: ${synced}`);
    console.log(`   Errors: ${errors}`);
    console.log(`${'='.repeat(60)}\n`);

    // 5. Verify cache
    const cacheCount = await db.collection('markets_cache').countDocuments();
    console.log(`✅ Markets cache now contains ${cacheCount} documents`);

    // 6. Show sample cached market
    const sample = await db.collection('markets_cache').findOne({});
    if (sample) {
      console.log('\n📝 Sample cached market:');
      console.log(JSON.stringify(sample, null, 2));
    }

  } catch (error: any) {
    console.error('❌ Fatal error during sync:', error);
    throw error;
  } finally {
    process.exit(0);
  }
}

// Run if executed directly
if (require.main === module) {
  syncMarketsCache().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { syncMarketsCache };
