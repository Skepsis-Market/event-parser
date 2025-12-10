/**
 * Fix BetPlaced events that were incorrectly stored as SHARES_SOLD
 * 
 * BUG: handleBetPlaced was storing event_type as 'SHARES_SOLD' instead of 'SHARES_PURCHASED'
 * This script corrects all misclassified events in the database
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/skepsis?authSource=admin';

async function fixBetPlacedEventTypes() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db('skepsis');
    
    console.log('🔧 Fixing misclassified BetPlaced events...\n');
    
    // Find all events that look like purchases but are marked as SHARES_SOLD
    // Characteristics:
    // - event_type = 'SHARES_SOLD'
    // - shares_delta > 0 (positive = received shares)
    // - usdc_delta < 0 (negative = paid USDC)
    
    const misclassified = await db.collection('position_events').find({
      event_type: 'SHARES_SOLD',
      shares_delta: { $gt: 0 },
      usdc_delta: { $lt: 0 }
    }).toArray();
    
    console.log(`📊 Found ${misclassified.length} misclassified BetPlaced events\n`);
    
    if (misclassified.length === 0) {
      console.log('✅ No events to fix!');
      return;
    }
    
    // Show some examples
    console.log('📋 Examples of misclassified events:');
    misclassified.slice(0, 3).forEach(event => {
      console.log(`   TX: ${event.tx_digest.slice(0, 20)}...`);
      console.log(`   Shares: +${(Number(event.shares_delta) / 1e6).toFixed(2)}`);
      console.log(`   USDC: -$${(-Number(event.usdc_delta) / 1e6).toFixed(2)}`);
      console.log(`   Timestamp: ${new Date(Number(event.timestamp)).toISOString()}`);
      console.log('');
    });
    
    // Fix all misclassified events
    const result = await db.collection('position_events').updateMany(
      {
        event_type: 'SHARES_SOLD',
        shares_delta: { $gt: 0 },
        usdc_delta: { $lt: 0 }
      },
      {
        $set: { event_type: 'SHARES_PURCHASED' }
      }
    );
    
    console.log(`✅ Fixed ${result.modifiedCount} events!\n`);
    
    // Verify the fix
    console.log('🔍 Verification:');
    const stillWrong = await db.collection('position_events').countDocuments({
      event_type: 'SHARES_SOLD',
      shares_delta: { $gt: 0 },
      usdc_delta: { $lt: 0 }
    });
    
    const purchases = await db.collection('position_events').countDocuments({
      event_type: 'SHARES_PURCHASED'
    });
    
    const sales = await db.collection('position_events').countDocuments({
      event_type: 'SHARES_SOLD'
    });
    
    console.log(`   SHARES_PURCHASED events: ${purchases}`);
    console.log(`   SHARES_SOLD events: ${sales}`);
    console.log(`   Still misclassified: ${stillWrong}`);
    
    if (stillWrong === 0) {
      console.log('\n🎉 All events corrected successfully!');
    } else {
      console.log('\n⚠️  Some events may still be wrong - manual review needed');
    }
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
    throw error;
  } finally {
    await client.close();
  }
}

fixBetPlacedEventTypes();
