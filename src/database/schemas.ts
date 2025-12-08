/**
 * MongoDB Schema Definitions for Position Tracking
 * 
 * This implements an event-sourced architecture where:
 * 1. All position events are stored immutably in 'position_events'
 * 2. Current position state is computed and cached in 'user_positions'
 * 3. The 'trades' collection remains for backwards compatibility
 */

import { Db } from 'mongodb';

export interface PositionEvent {
  // Event metadata
  tx_digest: string;
  checkpoint: bigint;
  timestamp: bigint;
  event_type: 'SHARES_PURCHASED' | 'SHARES_SOLD' | 'REWARDS_CLAIMED';
  
  // Position identification
  user_address: string;
  position_store_id?: string; // Optional: from newer contract versions
  market_id: string;
  
  // Range identification
  range_lower: bigint;
  range_upper: bigint;
  
  // Event data
  shares_delta: bigint; // Positive for buy, negative for sell
  usdc_delta: bigint;   // Cost paid (negative) or proceeds (positive)
  price_per_share: bigint;
  
  // Sell-specific fields
  position_index?: number; // Array index used in contract (null for buys)
  is_fifo_sell?: boolean;  // True if position_index was u64::MAX
  
  // Metadata
  indexed_at: Date;
}

export interface UserPosition {
  // Position identification (composite key)
  user_address: string;
  market_id: string;
  range_lower: bigint;
  range_upper: bigint;
  
  // Aggregated state (computed from events)
  total_shares: bigint;
  total_cost_basis: bigint; // Total USDC paid for these shares
  avg_entry_price: number;  // total_cost_basis / total_shares (in USDC)
  
  // Realized PnL (from completed sales)
  realized_pnl: bigint;
  total_shares_sold: bigint;
  total_proceeds: bigint;
  
  // Metadata
  first_purchase_at: bigint;
  last_updated_at: bigint;
  last_tx_digest: string;
  is_active: boolean; // False if total_shares = 0
  
  // For quick lookups
  market_name?: string; // Denormalized from markets collection
}

export interface MarketCache {
  market_id: string;
  market_name: string;
  category: string;
  min_value: bigint;
  max_value: bigint;
  bucket_count: number;
  bucket_width: bigint;
  resolution_time: bigint;
  current_price?: bigint; // Latest oracle price or settlement value
  status: 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
  resolved_value?: bigint;
  created_at: bigint;
  updated_at: Date;
}

/**
 * Create all necessary indexes for efficient querying
 */
export async function createIndexes(db: Db): Promise<void> {
  console.log('📊 Creating position tracking indexes...\n');
  
  // ===== POSITION_EVENTS Collection =====
  const eventsCollection = db.collection('position_events');
  
  await eventsCollection.createIndex(
    { tx_digest: 1, event_type: 1 },
    { unique: true, name: 'idx_tx_event_unique' }
  );
  console.log('✅ position_events: unique index on (tx_digest, event_type)');
  
  await eventsCollection.createIndex(
    { user_address: 1, market_id: 1 },
    { name: 'idx_user_market' }
  );
  console.log('✅ position_events: index on (user_address, market_id)');
  
  await eventsCollection.createIndex(
    { market_id: 1, range_lower: 1, range_upper: 1 },
    { name: 'idx_market_range' }
  );
  console.log('✅ position_events: index on (market_id, range_lower, range_upper)');
  
  await eventsCollection.createIndex(
    { checkpoint: 1 },
    { name: 'idx_checkpoint' }
  );
  console.log('✅ position_events: index on checkpoint');
  
  await eventsCollection.createIndex(
    { timestamp: -1 },
    { name: 'idx_timestamp_desc' }
  );
  console.log('✅ position_events: index on timestamp (descending)');
  
  // ===== USER_POSITIONS Collection =====
  const positionsCollection = db.collection('user_positions');
  
  await positionsCollection.createIndex(
    { user_address: 1, market_id: 1, range_lower: 1, range_upper: 1 },
    { unique: true, name: 'idx_position_composite_key' }
  );
  console.log('✅ user_positions: unique composite key');
  
  await positionsCollection.createIndex(
    { user_address: 1, is_active: 1 },
    { name: 'idx_user_active' }
  );
  console.log('✅ user_positions: index on (user_address, is_active)');
  
  await positionsCollection.createIndex(
    { market_id: 1, is_active: 1 },
    { name: 'idx_market_active' }
  );
  console.log('✅ user_positions: index on (market_id, is_active)');
  
  await positionsCollection.createIndex(
    { last_updated_at: -1 },
    { name: 'idx_last_updated_desc' }
  );
  console.log('✅ user_positions: index on last_updated_at (descending)');
  
  // ===== MARKETS Cache Collection =====
  const marketsCollection = db.collection('markets_cache');
  
  await marketsCollection.createIndex(
    { market_id: 1 },
    { unique: true, name: 'idx_market_id_unique' }
  );
  console.log('✅ markets_cache: unique index on market_id');
  
  await marketsCollection.createIndex(
    { status: 1, resolution_time: 1 },
    { name: 'idx_status_resolution' }
  );
  console.log('✅ markets_cache: index on (status, resolution_time)');
  
  // ===== TRADES Collection (existing - add missing indexes) =====
  const tradesCollection = db.collection('trades');
  
  try {
    await tradesCollection.createIndex(
      { user: 1, market_id: 1 },
      { name: 'idx_user_market_trades' }
    );
    console.log('✅ trades: index on (user, market_id)');
  } catch (error) {
    console.log('⚠️  trades: (user, market_id) index may already exist');
  }
  
  try {
    await tradesCollection.createIndex(
      { tx_hash: 1 },
      { unique: true, name: 'idx_tx_hash_unique' }
    );
    console.log('✅ trades: unique index on tx_hash');
  } catch (error) {
    console.log('⚠️  trades: tx_hash index may already exist');
  }
  
  console.log('\n✅ All indexes created successfully!\n');
}

/**
 * Migration helper: Populate position_events from existing trades
 */
export async function migrateExistingTrades(db: Db): Promise<void> {
  console.log('🔄 Migrating existing trades to position_events...\n');
  
  const trades = db.collection('trades');
  const positionEvents = db.collection('position_events');
  
  const cursor = trades.find({}).sort({ timestamp: 1 });
  let migrated = 0;
  let skipped = 0;
  
  for await (const trade of cursor) {
    try {
      const eventType = 
        trade.action === 'BUY' ? 'SHARES_PURCHASED' :
        trade.action === 'SELL' ? 'SHARES_SOLD' :
        trade.action === 'CLAIM' ? 'REWARDS_CLAIMED' :
        null;
      
      if (!eventType) {
        console.log(`⚠️  Unknown action: ${trade.action} (tx: ${trade.tx_hash})`);
        skipped++;
        continue;
      }
      
      // Calculate shares_delta and usdc_delta
      const sharesDelta = 
        trade.action === 'BUY' ? BigInt(trade.shares) :
        trade.action === 'SELL' ? -BigInt(trade.shares) :
        -BigInt(trade.shares); // CLAIM removes shares
      
      const usdcDelta =
        trade.action === 'BUY' ? -BigInt(trade.amount) : // Paid out
        BigInt(trade.amount); // Received
      
      await positionEvents.insertOne({
        tx_digest: trade.tx_hash,
        checkpoint: BigInt(trade.block_number || 0),
        timestamp: BigInt(trade.timestamp),
        event_type: eventType,
        user_address: trade.user,
        market_id: trade.market_id,
        range_lower: BigInt(trade.range.start),
        range_upper: BigInt(trade.range.end),
        shares_delta: sharesDelta,
        usdc_delta: usdcDelta,
        price_per_share: BigInt(trade.price_per_share),
        indexed_at: trade.indexed_at || new Date(),
      });
      
      migrated++;
      
      if (migrated % 100 === 0) {
        console.log(`   Migrated ${migrated} trades...`);
      }
    } catch (error: any) {
      if (error.code === 11000) {
        skipped++;
      } else {
        console.error(`❌ Migration error for trade ${trade._id}:`, error.message);
      }
    }
  }
  
  console.log(`\n✅ Migration complete!`);
  console.log(`   Migrated: ${migrated} trades`);
  console.log(`   Skipped: ${skipped} (duplicates or errors)\n`);
}

/**
 * Rebuild user_positions from position_events
 */
export async function rebuildPositions(db: Db): Promise<void> {
  console.log('🔨 Rebuilding user_positions from position_events...\n');
  
  const positionEvents = db.collection('position_events');
  const userPositions = db.collection('user_positions');
  
  // Clear existing positions
  await userPositions.deleteMany({});
  console.log('✅ Cleared existing user_positions');
  
  // Group by (user, market, range) and aggregate
  const pipeline = [
    {
      $sort: { timestamp: 1 }
    },
    {
      $group: {
        _id: {
          user: '$user_address',
          market: '$market_id',
          range_lower: '$range_lower',
          range_upper: '$range_upper'
        },
        // Sum all share deltas
        total_shares: { $sum: { $toLong: '$shares_delta' } },
        // Calculate cost basis (only from purchases)
        total_cost_basis: {
          $sum: {
            $cond: [
              { $gt: ['$shares_delta', 0] }, // If purchase
              { $abs: { $toLong: '$usdc_delta' } }, // Add cost
              0
            ]
          }
        },
        // Calculate realized PnL (only from sales)
        realized_pnl: {
          $sum: {
            $cond: [
              { $lt: ['$shares_delta', 0] }, // If sale
              { $toLong: '$usdc_delta' }, // Add proceeds
              0
            ]
          }
        },
        total_shares_sold: {
          $sum: {
            $cond: [
              { $lt: ['$shares_delta', 0] },
              { $abs: { $toLong: '$shares_delta' } },
              0
            ]
          }
        },
        total_proceeds: {
          $sum: {
            $cond: [
              { $lt: ['$shares_delta', 0] },
              { $toLong: '$usdc_delta' },
              0
            ]
          }
        },
        first_purchase_at: { $min: '$timestamp' },
        last_updated_at: { $max: '$timestamp' },
        last_tx_digest: { $last: '$tx_digest' }
      }
    },
    {
      $match: {
        // Only keep positions with shares > 0 OR realized PnL != 0
        $or: [
          { total_shares: { $gt: 0 } },
          { realized_pnl: { $ne: 0 } }
        ]
      }
    }
  ];
  
  const results = await positionEvents.aggregate(pipeline).toArray();
  
  if (results.length === 0) {
    console.log('⚠️  No positions found to rebuild');
    return;
  }
  
  const positions = results.map(result => {
    const totalShares = BigInt(result.total_shares || 0);
    const totalCostBasis = BigInt(result.total_cost_basis || 0);
    const avgEntryPrice = totalShares > 0n 
      ? Number(totalCostBasis) / Number(totalShares)
      : 0;
    
    return {
      user_address: result._id.user,
      market_id: result._id.market,
      range_lower: BigInt(result._id.range_lower),
      range_upper: BigInt(result._id.range_upper),
      total_shares: totalShares,
      total_cost_basis: totalCostBasis,
      avg_entry_price: avgEntryPrice,
      realized_pnl: BigInt(result.realized_pnl || 0),
      total_shares_sold: BigInt(result.total_shares_sold || 0),
      total_proceeds: BigInt(result.total_proceeds || 0),
      first_purchase_at: BigInt(result.first_purchase_at),
      last_updated_at: BigInt(result.last_updated_at),
      last_tx_digest: result.last_tx_digest,
      is_active: totalShares > 0n,
    };
  });
  
  await userPositions.insertMany(positions);
  
  console.log(`✅ Rebuilt ${positions.length} positions\n`);
}
