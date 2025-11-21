import { connectDB, closeDB } from './db/connection';
import { initializeCollections } from './db/init';
import { EventPoller } from './indexer/poller';
import { suiClient } from './sui/client';
import { resolutionScheduler } from './scheduler/resolution-scheduler';

async function main() {
  console.log('🚀 Skepsis Event Parser Starting (POLLING MODE)...\n');

  try {
    // Connect to database
    const db = await connectDB();
    
    // Initialize collections and indexes
    await initializeCollections(db);
    
    // Initialize resolution scheduler
    await resolutionScheduler.initialize(db);
    
    console.log('\n📡 Starting event poller...\n');
    
    // Start event poller
    const poller = new EventPoller(suiClient, db);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n⏹️  Shutting down gracefully...');
      poller.stop();
      await closeDB();
      process.exit(0);
    });
    
    await poller.start();
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await closeDB();
    process.exit(1);
  }
}

main();
