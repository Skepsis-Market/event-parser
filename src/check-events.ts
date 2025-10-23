import { connectDB, closeDB } from './db/connection';

async function checkEvents() {
  console.log('🔍 Checking database for indexed events...\n');
  
  try {
    const db = await connectDB();
    
    // Count trades
    const tradesCount = await db.collection('trades').countDocuments();
    console.log(`📊 Total trades: ${tradesCount}`);
    
    if (tradesCount > 0) {
      console.log('\n📋 Recent trades:');
      const trades = await db.collection('trades')
        .find()
        .sort({ timestamp: -1 })
        .limit(5)
        .toArray();
      
      trades.forEach((trade, i) => {
        console.log(`\n${i + 1}. ${trade.action} Trade`);
        console.log(`   User: ${trade.user}`);
        console.log(`   Market: ${trade.market_id}`);
        console.log(`   Shares: ${trade.shares}`);
        console.log(`   Amount: ${trade.amount} (${Number(trade.amount) / 1_000_000} USDC)`);
        console.log(`   Range: [${trade.range.start}, ${trade.range.end}]`);
        console.log(`   TX: ${trade.tx_hash}`);
        console.log(`   Time: ${new Date(Number(trade.timestamp)).toISOString()}`);
      });
    } else {
      console.log('\n⚠️  No trades found in database');
    }
    
    // Check last event
    console.log('\n📌 Last indexed event:');
    const lastEvent = await db.collection('indexer_state').findOne({ _id: 'last_event' } as any);
    if (lastEvent) {
      console.log(`   TX: ${lastEvent.tx_digest}`);
      console.log(`   Seq: ${lastEvent.event_seq}`);
      console.log(`   Updated: ${lastEvent.updated_at}`);
    } else {
      console.log('   None');
    }
    
    await closeDB();
  } catch (error) {
    console.error('❌ Error:', error);
    await closeDB();
    process.exit(1);
  }
}

checkEvents();
