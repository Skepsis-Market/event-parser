#!/usr/bin/env ts-node

/**
 * Migration Script: Setup Position Tracking System
 * 
 * This script:
 * 1. Creates necessary indexes for position tracking collections
 * 2. Migrates existing trades to position_events
 * 3. Rebuilds user_positions from events
 * 
 * Run once to migrate from old system to new position tracking
 */

import { MongoClient } from 'mongodb';
import CONFIG from '../config/env';
import { createIndexes, migrateExistingTrades, rebuildPositions } from '../database/schemas';

async function main() {
  console.log('🔄 Position Tracking Migration Script\n');
  console.log('═══════════════════════════════════════\n');
  
  const client = new MongoClient(CONFIG.mongodbUri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db(CONFIG.mongodbDb);
    
    // Step 1: Create indexes
    console.log('📊 Step 1: Creating Indexes\n');
    await createIndexes(db);
    
    // Step 2: Migrate existing trades (if any)
    console.log('\n🔄 Step 2: Migrating Existing Trades\n');
    const tradesCount = await db.collection('trades').countDocuments();
    
    if (tradesCount > 0) {
      console.log(`Found ${tradesCount} existing trades to migrate\n`);
      await migrateExistingTrades(db);
    } else {
      console.log('No existing trades found - skipping migration\n');
    }
    
    // Step 3: Rebuild positions from events
    console.log('\n🔨 Step 3: Rebuilding Position Aggregates\n');
    const eventsCount = await db.collection('position_events').countDocuments();
    
    if (eventsCount > 0) {
      console.log(`Found ${eventsCount} position events\n`);
      await rebuildPositions(db);
    } else {
      console.log('No position events found - skipping rebuild\n');
    }
    
    // Step 4: Show summary
    console.log('\n📊 Migration Summary\n');
    console.log('═══════════════════════════════════════');
    
    const stats = {
      trades: await db.collection('trades').countDocuments(),
      position_events: await db.collection('position_events').countDocuments(),
      user_positions: await db.collection('user_positions').countDocuments(),
      active_positions: await db.collection('user_positions').countDocuments({ is_active: true }),
      markets_cache: await db.collection('markets_cache').countDocuments(),
    };
    
    console.log(`✅ Legacy trades: ${stats.trades}`);
    console.log(`✅ Position events: ${stats.position_events}`);
    console.log(`✅ User positions: ${stats.user_positions}`);
    console.log(`   └─ Active: ${stats.active_positions}`);
    console.log(`✅ Markets cached: ${stats.markets_cache}`);
    
    console.log('\n🎉 Migration Complete!\n');
    console.log('Next steps:');
    console.log('1. Restart your event indexer');
    console.log('2. New events will automatically populate all collections');
    console.log('3. Implement API endpoints (see API_ENDPOINTS.md)\n');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 Disconnected from MongoDB\n');
  }
}

main();
