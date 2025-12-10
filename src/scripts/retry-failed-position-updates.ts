/**
 * Retry Failed Position Updates
 * Processes markets where position updates failed during resolution
 * Run this script if position updates fail due to timeout, network issues, etc.
 */

import { MongoClient } from 'mongodb';
import CONFIG from '../config/env';
import { PositionTracker } from '../database/position-tracker';

async function retryFailedPositionUpdates() {
  console.log('🔄 Retrying failed position updates...\n');

  const client = new MongoClient(CONFIG.mongodbUri);
  await client.connect();
  const db = client.db(CONFIG.mongodbDb);

  try {
    const positionTracker = new PositionTracker(db);

    // Find all failed update jobs
    const failedJobs = await db.collection('failed_position_updates')
      .find({ retryCount: { $lt: 3 } })  // Only retry up to 3 times
      .sort({ timestamp: 1 })  // Oldest first
      .toArray();

    console.log(`📊 Found ${failedJobs.length} failed update jobs\n`);

    if (failedJobs.length === 0) {
      console.log('✅ No failed updates to retry');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const job of failedJobs) {
      const { marketId, resolvedValue, retryCount } = job;
      
      console.log(`\n🔄 Retrying market ${marketId.slice(0, 10)}... (attempt ${retryCount + 1}/3)`);
      console.log(`   Resolved value: ${resolvedValue}`);

      try {
        const startTime = Date.now();

        // Attempt position updates
        const lostResult = await positionTracker.closeLosingPositions(
          marketId,
          BigInt(resolvedValue)
        );

        const wonResult = await positionTracker.calculateWinningPositions(
          marketId,
          BigInt(resolvedValue)
        );

        const totalUpdated = lostResult.modifiedCount + wonResult.modifiedCount;
        const duration = Date.now() - startTime;

        console.log(`   ✅ Success: ${totalUpdated} positions updated in ${duration}ms`);

        // Mark as completed
        await db.collection('failed_position_updates').deleteOne({ _id: job._id });

        successCount++;

      } catch (error: any) {
        console.error(`   ❌ Retry failed:`, error.message);

        // Increment retry count
        await db.collection('failed_position_updates').updateOne(
          { _id: job._id },
          {
            $set: {
              lastRetryAt: new Date(),
              lastError: error.message
            },
            $inc: { retryCount: 1 }
          }
        );

        failCount++;
      }
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Retry Summary:`);
    console.log(`   Total jobs: ${failedJobs.length}`);
    console.log(`   Successful: ${successCount}`);
    console.log(`   Failed: ${failCount}`);
    console.log(`${'='.repeat(60)}\n`);

    // Check for jobs that hit max retries
    const maxRetriesJobs = await db.collection('failed_position_updates')
      .countDocuments({ retryCount: { $gte: 3 } });

    if (maxRetriesJobs > 0) {
      console.warn(`⚠️  ${maxRetriesJobs} jobs hit max retries (3) - manual intervention needed`);
      
      const samples = await db.collection('failed_position_updates')
        .find({ retryCount: { $gte: 3 } })
        .limit(5)
        .toArray();
      
      console.log('\n📝 Sample failed jobs:');
      samples.forEach(job => {
        console.log(`   Market: ${job.marketId}`);
        console.log(`   Error: ${job.lastError}`);
        console.log(`   ---`);
      });
    }

  } catch (error: any) {
    console.error('❌ Fatal error during retry:', error);
    throw error;
  } finally {
    await client.close();
    process.exit(0);
  }
}

// Run if executed directly
if (require.main === module) {
  retryFailedPositionUpdates().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { retryFailedPositionUpdates };
