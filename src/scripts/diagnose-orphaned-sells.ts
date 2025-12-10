/**
 * Diagnose SELL events without realized_pnl_delta
 * 
 * Helps identify why some events couldn't be backfilled
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/skepsis?authSource=admin';

async function diagnoseOrphanedSells() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db('skepsis');
    
    console.log('🔍 Diagnosing SELL events without realized_pnl_delta...\n');
    
    // Find SELL events without realized_pnl_delta
    const orphanedSells = await db.collection('position_events')
      .find({
        event_type: 'SHARES_SOLD',
        realized_pnl_delta: { $exists: false }
      })
      .sort({ timestamp: 1 })
      .limit(10)
      .toArray();
    
    console.log(`📊 Found ${orphanedSells.length} examples (showing first 10):\n`);
    
    for (const sell of orphanedSells) {
      console.log(`Market: ${sell.market_id.slice(0, 10)}...`);
      console.log(`User: ${sell.user_address.slice(0, 10)}...`);
      console.log(`Timestamp: ${new Date(Number(sell.timestamp)).toISOString()}`);
      
      // Check if there are any purchases for this position
      const purchases = await db.collection('position_events')
        .find({
          user_address: sell.user_address,
          market_id: sell.market_id,
          range_lower: sell.range_lower,
          range_upper: sell.range_upper,
          event_type: 'SHARES_PURCHASED',
          timestamp: { $lt: sell.timestamp }
        })
        .toArray();
      
      if (purchases.length === 0) {
        console.log(`⚠️  Reason: No prior purchases found (orphaned sell)`);
        
        // Check if there are ANY events for this position
        const allEvents = await db.collection('position_events')
          .find({
            user_address: sell.user_address,
            market_id: sell.market_id,
            range_lower: sell.range_lower,
            range_upper: sell.range_upper
          })
          .toArray();
        
        console.log(`   Total events for this position: ${allEvents.length}`);
        console.log(`   Event types: ${allEvents.map(e => e.event_type).join(', ')}`);
      } else {
        console.log(`✅ Found ${purchases.length} prior purchases`);
        console.log(`⚠️  Reason: Unknown (shouldn't happen - check migration logic)`);
      }
      
      console.log('');
    }
    
    // Summary statistics
    const totalOrphaned = await db.collection('position_events').countDocuments({
      event_type: 'SHARES_SOLD',
      realized_pnl_delta: { $exists: false }
    });
    
    console.log(`\n📈 Summary:`);
    console.log(`   Total orphaned SELL events: ${totalOrphaned}`);
    console.log(`\n💡 These are likely sales from before we started indexing,`);
    console.log(`   or from positions that were opened outside our event history.`);
    console.log(`   They can be safely ignored as the data is incomplete.`);
    
  } catch (error) {
    console.error('❌ Diagnosis failed:', error);
  } finally {
    await client.close();
  }
}

diagnoseOrphanedSells();
