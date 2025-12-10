/**
 * Backfill realized_pnl_delta for existing SELL and CLAIM events
 * 
 * This migration calculates the per-transaction PnL for historical events
 * by reconstructing the cost basis at the time of each transaction.
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/skepsis?authSource=admin';

interface PositionEvent {
  _id: any;
  tx_digest: string;
  timestamp: bigint;
  event_type: string;
  user_address: string;
  market_id: string;
  range_lower: bigint;
  range_upper: bigint;
  shares_delta: bigint;
  usdc_delta: bigint;
  realized_pnl_delta?: bigint;
}

async function backfillRealizedPnlDelta() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db('skepsis');
    
    console.log('🔄 Starting realized_pnl_delta backfill migration...\n');
    
    // Get all unique user-market-range combinations
    const positions = await db.collection('position_events')
      .aggregate([
        {
          $group: {
            _id: {
              user: '$user_address',
              market: '$market_id',
              lower: '$range_lower',
              upper: '$range_upper'
            }
          }
        }
      ])
      .toArray();
    
    console.log(`📊 Found ${positions.length} unique positions to process\n`);
    
    let totalSellsUpdated = 0;
    let totalClaimsUpdated = 0;
    let positionsProcessed = 0;
    
    // Process each position
    for (const pos of positions) {
      const { user, market, lower, upper } = pos._id;
      
      // Get all events for this position in chronological order
      const events = await db.collection('position_events')
        .find({
          user_address: user,
          market_id: market,
          range_lower: lower,
          range_upper: upper
        })
        .sort({ timestamp: 1 })
        .toArray() as PositionEvent[];
      
      // Reconstruct position state over time
      let totalShares = 0n;
      let totalCostBasis = 0n;
      
      for (const event of events) {
        if (event.event_type === 'SHARES_PURCHASED') {
          // Buy: add to position
          const sharesPurchased = BigInt(event.shares_delta);
          const cost = -BigInt(event.usdc_delta); // Negative in DB
          
          totalShares += sharesPurchased;
          totalCostBasis += cost;
          
        } else if (event.event_type === 'SHARES_SOLD') {
          // Sell: calculate PnL if not already set
          if (!event.realized_pnl_delta && totalShares > 0n) {
            const sharesSold = -BigInt(event.shares_delta); // Negative in DB
            const proceeds = BigInt(event.usdc_delta); // Positive in DB
            
            // Calculate cost basis of shares sold (weighted average)
            const avgCostPerShare = Number(totalCostBasis) / Number(totalShares);
            const costBasisOfSold = BigInt(Math.floor(avgCostPerShare * Number(sharesSold)));
            const realizedPnlDelta = proceeds - costBasisOfSold;
            
            // Update the event
            await db.collection('position_events').updateOne(
              { _id: event._id },
              { $set: { realized_pnl_delta: realizedPnlDelta } }
            );
            
            totalSellsUpdated++;
            
            // Update position state
            totalShares -= sharesSold;
            totalCostBasis -= costBasisOfSold;
          }
          
        } else if (event.event_type === 'REWARDS_CLAIMED') {
          // Claim: PnL = payout - remaining cost basis
          if (!event.realized_pnl_delta) {
            const payout = BigInt(event.usdc_delta); // Positive in DB
            const realizedPnlDelta = payout - totalCostBasis;
            
            // Update the event
            await db.collection('position_events').updateOne(
              { _id: event._id },
              { $set: { realized_pnl_delta: realizedPnlDelta } }
            );
            
            totalClaimsUpdated++;
            
            // Position closed after claim
            totalShares = 0n;
            totalCostBasis = 0n;
          }
        }
      }
      
      positionsProcessed++;
      if (positionsProcessed % 50 === 0) {
        console.log(`   ⏳ Processed ${positionsProcessed}/${positions.length} positions...`);
      }
    }
    
    console.log(`\n✅ Migration complete!\n`);
    console.log(`📈 Summary:`);
    console.log(`   Positions processed: ${positionsProcessed}`);
    console.log(`   SELL events updated: ${totalSellsUpdated}`);
    console.log(`   CLAIM events updated: ${totalClaimsUpdated}`);
    console.log(`   Total events updated: ${totalSellsUpdated + totalClaimsUpdated}`);
    
    // Verify results
    console.log('\n🔍 Verification:');
    const sellsWithPnl = await db.collection('position_events').countDocuments({
      event_type: 'SHARES_SOLD',
      realized_pnl_delta: { $exists: true }
    });
    
    const claimsWithPnl = await db.collection('position_events').countDocuments({
      event_type: 'REWARDS_CLAIMED',
      realized_pnl_delta: { $exists: true }
    });
    
    const totalSells = await db.collection('position_events').countDocuments({
      event_type: 'SHARES_SOLD'
    });
    
    const totalClaims = await db.collection('position_events').countDocuments({
      event_type: 'REWARDS_CLAIMED'
    });
    
    console.log(`   SELL events: ${sellsWithPnl}/${totalSells} have realized_pnl_delta`);
    console.log(`   CLAIM events: ${claimsWithPnl}/${totalClaims} have realized_pnl_delta`);
    
    if (sellsWithPnl === totalSells && claimsWithPnl === totalClaims) {
      console.log('\n🎉 All events successfully backfilled!');
    } else {
      console.log('\n⚠️  Some events may not have been backfilled (check for orphaned sells/claims without purchases)');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.close();
  }
}

// Run migration
console.log('⚠️  This migration will update existing position_events in the database.');
console.log('⚠️  It is safe to run multiple times (will skip already-updated events).\n');

backfillRealizedPnlDelta();
