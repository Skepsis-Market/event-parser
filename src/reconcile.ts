import { connectDB, closeDB } from './db/connection';
import { reconcileMarketPositions } from './reconciliation/reconcile';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: npm run reconcile <marketId> <resolutionValue>');
    console.error('Example: npm run reconcile 0x123abc... 105000');
    process.exit(1);
  }
  
  const marketId = args[0];
  const resolutionValue = BigInt(args[1]);
  
  console.log('🔄 Skepsis Reconciliation Tool\n');
  console.log(`Market ID: ${marketId}`);
  console.log(`Resolution Value: ${resolutionValue}`);
  
  try {
    const db = await connectDB();
    
    await reconcileMarketPositions(db, marketId, resolutionValue);
    
    console.log('✅ Reconciliation completed successfully!');
    
    await closeDB();
    process.exit(0);
  } catch (error) {
    console.error('❌ Reconciliation failed:', error);
    await closeDB();
    process.exit(1);
  }
}

main();
