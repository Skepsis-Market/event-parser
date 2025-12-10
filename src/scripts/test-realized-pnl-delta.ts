/**
 * Test script to verify realized_pnl_delta is correctly stored in position_events
 * 
 * This validates the enhancement that enables per-transaction PnL tracking
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/skepsis?authSource=admin';

async function testRealizedPnlDelta() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db('skepsis');
    
    console.log('🔍 Testing realized_pnl_delta in position_events...\n');
    
    // Check SELL events with realized_pnl_delta
    console.log('📊 Checking SHARES_SOLD events:');
    const sellEvents = await db.collection('position_events')
      .find({ 
        event_type: 'SHARES_SOLD',
        realized_pnl_delta: { $exists: true }
      })
      .sort({ timestamp: -1 })
      .limit(5)
      .toArray();
    
    if (sellEvents.length === 0) {
      console.log('   ⚠️  No SELL events with realized_pnl_delta found');
      console.log('   💡 This is expected if indexer hasn\'t processed any new sales after this enhancement');
    } else {
      console.log(`   ✅ Found ${sellEvents.length} SELL events with PnL tracking:\n`);
      sellEvents.forEach((event: any) => {
        const pnl = Number(event.realized_pnl_delta) / 1_000_000;
        const proceeds = Number(event.usdc_delta) / 1_000_000;
        const shares = Math.abs(Number(event.shares_delta)) / 1_000_000;
        const pnlSign = pnl >= 0 ? '+' : '';
        
        console.log(`      Market: ${event.market_id.slice(0, 10)}...`);
        console.log(`      User: ${event.user_address.slice(0, 10)}...`);
        console.log(`      Shares Sold: ${shares.toFixed(2)}`);
        console.log(`      Proceeds: $${proceeds.toFixed(2)}`);
        console.log(`      Realized PnL: ${pnlSign}$${pnl.toFixed(2)}`);
        console.log(`      Timestamp: ${new Date(Number(event.timestamp)).toISOString()}`);
        console.log('');
      });
    }
    
    // Check CLAIM events with realized_pnl_delta
    console.log('🏆 Checking REWARDS_CLAIMED events:');
    const claimEvents = await db.collection('position_events')
      .find({ 
        event_type: 'REWARDS_CLAIMED',
        realized_pnl_delta: { $exists: true }
      })
      .sort({ timestamp: -1 })
      .limit(5)
      .toArray();
    
    if (claimEvents.length === 0) {
      console.log('   ⚠️  No CLAIM events with realized_pnl_delta found');
      console.log('   💡 This is expected if indexer hasn\'t processed any claims after this enhancement');
    } else {
      console.log(`   ✅ Found ${claimEvents.length} CLAIM events with PnL tracking:\n`);
      claimEvents.forEach((event: any) => {
        const pnl = Number(event.realized_pnl_delta) / 1_000_000;
        const payout = Number(event.usdc_delta) / 1_000_000;
        const shares = Math.abs(Number(event.shares_delta)) / 1_000_000;
        const pnlSign = pnl >= 0 ? '+' : '';
        
        console.log(`      Market: ${event.market_id.slice(0, 10)}...`);
        console.log(`      User: ${event.user_address.slice(0, 10)}...`);
        console.log(`      Shares Claimed: ${shares.toFixed(2)}`);
        console.log(`      Payout: $${payout.toFixed(2)}`);
        console.log(`      Realized PnL: ${pnlSign}$${pnl.toFixed(2)}`);
        console.log(`      Timestamp: ${new Date(Number(event.timestamp)).toISOString()}`);
        console.log('');
      });
    }
    
    // Summary statistics
    console.log('📈 Summary:');
    const totalSellsWithPnl = await db.collection('position_events').countDocuments({
      event_type: 'SHARES_SOLD',
      realized_pnl_delta: { $exists: true }
    });
    
    const totalClaimsWithPnl = await db.collection('position_events').countDocuments({
      event_type: 'REWARDS_CLAIMED',
      realized_pnl_delta: { $exists: true }
    });
    
    const totalSells = await db.collection('position_events').countDocuments({
      event_type: 'SHARES_SOLD'
    });
    
    const totalClaims = await db.collection('position_events').countDocuments({
      event_type: 'REWARDS_CLAIMED'
    });
    
    console.log(`   Total SELL events: ${totalSells}`);
    console.log(`   With realized_pnl_delta: ${totalSellsWithPnl}`);
    console.log(`   Total CLAIM events: ${totalClaims}`);
    console.log(`   With realized_pnl_delta: ${totalClaimsWithPnl}`);
    
    if (totalSellsWithPnl === 0 && totalClaimsWithPnl === 0) {
      console.log('\n💡 Next Steps:');
      console.log('   1. Run the indexer to process new events');
      console.log('   2. Perform a test trade (buy -> sell) on a market');
      console.log('   3. Re-run this script to verify realized_pnl_delta is populated');
    } else {
      console.log('\n✅ Enhancement working! Per-transaction PnL now available in position_events');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await client.close();
  }
}

testRealizedPnlDelta();
