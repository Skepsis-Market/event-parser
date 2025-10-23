import { connectDB, closeDB } from './db/connection';
import { initializeCollections } from './db/init';
import { EventListener } from './indexer/listener';
import { suiClient } from './sui/client';

async function main() {
  console.log('🚀 Skepsis Event Parser Starting...\n');

  try {
    // Connect to database
    const db = await connectDB();
    
    // Initialize collections and indexes
    await initializeCollections(db);
    
    console.log('\n📡 Starting WebSocket event listener...\n');
    
    // Start event listener
    const listener = new EventListener(suiClient, db);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n⏹️  Shutting down gracefully...');
      await listener.stop();
      await closeDB();
      process.exit(0);
    });
    
    await listener.start();
    
    // Keep process alive
    await new Promise(() => {});
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await closeDB();
    process.exit(1);
  }
}

main();
