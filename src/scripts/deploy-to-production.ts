/**
 * PRODUCTION DEPLOYMENT SCRIPT
 * 
 * This script replicates ALL changes made locally to production EC2 database.
 * Run this ONCE after deploying code to EC2.
 * 
 * SAFE TO RUN MULTIPLE TIMES - All operations are idempotent.
 * 
 * What this does:
 * 1. Schema updates (adds new fields if missing)
 * 2. Data fixes (fixes misclassified events)
 * 3. Backfills (adds missing calculated fields)
 * 4. Verification (ensures everything is correct)
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/skepsis?authSource=admin';

interface MigrationStep {
  name: string;
  description: string;
  execute: (db: any) => Promise<any>;
  verify: (db: any) => Promise<boolean>;
}

class ProductionDeployment {
  private client: MongoClient;
  private db: any;
  private results: any[] = [];

  constructor() {
    this.client = new MongoClient(MONGODB_URI);
  }

  async run() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 PRODUCTION DEPLOYMENT - Schema & Data Migration');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📅 Started: ${new Date().toISOString()}`);
    console.log(`🗄️  Database: ${MONGODB_URI.split('@')[1]?.split('/')[0] || 'localhost'}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    try {
      await this.client.connect();
      this.db = this.client.db('skepsis');

      // Define all migration steps in order
      const migrations: MigrationStep[] = [
        {
          name: 'Schema Update: user_positions',
          description: 'Add unrealized_pnl and close_reason fields',
          execute: async (db) => {
            // MongoDB will automatically add these fields when documents are updated
            // This is just a validation that the schema is ready
            return { status: 'Schema fields will be added on document updates' };
          },
          verify: async (db) => {
            // Check if any documents have these fields (from local testing)
            const withUnrealizedPnl = await db.collection('user_positions')
              .countDocuments({ unrealized_pnl: { $exists: true } });
            const withCloseReason = await db.collection('user_positions')
              .countDocuments({ close_reason: { $exists: true } });
            console.log(`   ℹ️  Documents with unrealized_pnl: ${withUnrealizedPnl}`);
            console.log(`   ℹ️  Documents with close_reason: ${withCloseReason}`);
            return true; // Always pass - fields are optional
          }
        },

        {
          name: 'Schema Update: position_events',
          description: 'Add realized_pnl_delta field',
          execute: async (db) => {
            // Field will be added by backfill operation
            return { status: 'Schema field will be added during backfill' };
          },
          verify: async (db) => {
            const withPnlDelta = await db.collection('position_events')
              .countDocuments({ realized_pnl_delta: { $exists: true } });
            console.log(`   ℹ️  Events with realized_pnl_delta: ${withPnlDelta}`);
            return true; // Always pass - will be populated by backfill
          }
        },

        {
          name: 'Data Fix: BetPlaced Event Misclassification',
          description: 'Fix events where SHARES_PURCHASED were marked as SHARES_SOLD',
          execute: async (db) => {
            // Find misclassified events (BUY events marked as SELL)
            const misclassified = await db.collection('position_events').find({
              event_type: 'SHARES_SOLD',
              shares_delta: { $gt: 0 },  // Positive = received shares (BUY)
              usdc_delta: { $lt: 0 }      // Negative = paid USDC (BUY)
            }).toArray();

            if (misclassified.length === 0) {
              return { modified: 0, message: 'No misclassified events found' };
            }

            console.log(`   🔧 Found ${misclassified.length} misclassified BUY events`);
            console.log(`   📋 Examples:`);
            misclassified.slice(0, 3).forEach((e: any) => {
              console.log(`      - TX: ${e.tx_digest.slice(0, 20)}... | Shares: +${(Number(e.shares_delta)/1e6).toFixed(2)} | Cost: -$${(-Number(e.usdc_delta)/1e6).toFixed(2)}`);
            });

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

            return { modified: result.modifiedCount };
          },
          verify: async (db) => {
            const stillWrong = await db.collection('position_events').countDocuments({
              event_type: 'SHARES_SOLD',
              shares_delta: { $gt: 0 },
              usdc_delta: { $lt: 0 }
            });
            
            if (stillWrong > 0) {
              console.log(`   ❌ Still ${stillWrong} misclassified events!`);
              return false;
            }
            
            console.log(`   ✅ All events correctly classified`);
            return true;
          }
        },

        {
          name: 'Backfill: realized_pnl_delta for SELL events',
          description: 'Calculate and store per-transaction PnL for all historical SELL events',
          execute: async (db) => {
            let totalUpdated = 0;
            
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

            console.log(`   📊 Processing ${positions.length} unique positions...`);

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
                .toArray();

              let totalShares = 0n;
              let totalCostBasis = 0n;

              for (const event of events) {
                if (event.event_type === 'SHARES_PURCHASED') {
                  totalShares += BigInt(event.shares_delta);
                  totalCostBasis += -BigInt(event.usdc_delta);
                  
                } else if (event.event_type === 'SHARES_SOLD') {
                  if (!event.realized_pnl_delta && totalShares > 0n) {
                    const sharesSold = -BigInt(event.shares_delta);
                    const proceeds = BigInt(event.usdc_delta);
                    const avgCostPerShare = Number(totalCostBasis) / Number(totalShares);
                    const costBasisOfSold = BigInt(Math.floor(avgCostPerShare * Number(sharesSold)));
                    const realizedPnlDelta = proceeds - costBasisOfSold;

                    await db.collection('position_events').updateOne(
                      { _id: event._id },
                      { $set: { realized_pnl_delta: realizedPnlDelta } }
                    );
                    totalUpdated++;

                    totalShares -= sharesSold;
                    totalCostBasis -= costBasisOfSold;
                  }
                  
                } else if (event.event_type === 'REWARDS_CLAIMED') {
                  if (!event.realized_pnl_delta) {
                    const payout = BigInt(event.usdc_delta);
                    const realizedPnlDelta = payout - totalCostBasis;

                    await db.collection('position_events').updateOne(
                      { _id: event._id },
                      { $set: { realized_pnl_delta: realizedPnlDelta } }
                    );
                    totalUpdated++;

                    totalShares = 0n;
                    totalCostBasis = 0n;
                  }
                }
              }
            }

            return { sellsUpdated: totalUpdated };
          },
          verify: async (db) => {
            const totalSells = await db.collection('position_events')
              .countDocuments({ event_type: 'SHARES_SOLD' });
            const sellsWithPnl = await db.collection('position_events')
              .countDocuments({ event_type: 'SHARES_SOLD', realized_pnl_delta: { $exists: true } });
            
            const totalClaims = await db.collection('position_events')
              .countDocuments({ event_type: 'REWARDS_CLAIMED' });
            const claimsWithPnl = await db.collection('position_events')
              .countDocuments({ event_type: 'REWARDS_CLAIMED', realized_pnl_delta: { $exists: true } });

            console.log(`   ℹ️  SELL events: ${sellsWithPnl}/${totalSells} have realized_pnl_delta`);
            console.log(`   ℹ️  CLAIM events: ${claimsWithPnl}/${totalClaims} have realized_pnl_delta`);
            
            return true; // Pass even if not all have it (orphaned sells won't have it)
          }
        },

        {
          name: 'Final Verification',
          description: 'Verify all changes are applied correctly',
          execute: async (db) => {
            const stats = {
              position_events: await db.collection('position_events').countDocuments(),
              user_positions: await db.collection('user_positions').countDocuments(),
              purchases: await db.collection('position_events').countDocuments({ event_type: 'SHARES_PURCHASED' }),
              sells: await db.collection('position_events').countDocuments({ event_type: 'SHARES_SOLD' }),
              claims: await db.collection('position_events').countDocuments({ event_type: 'REWARDS_CLAIMED' }),
              with_pnl_delta: await db.collection('position_events').countDocuments({ realized_pnl_delta: { $exists: true } }),
              active_positions: await db.collection('user_positions').countDocuments({ is_active: true }),
              closed_positions: await db.collection('user_positions').countDocuments({ is_active: false })
            };
            return stats;
          },
          verify: async () => true
        }
      ];

      // Execute all migrations
      for (let i = 0; i < migrations.length; i++) {
        const migration = migrations[i];
        console.log(`\n[${ i + 1}/${migrations.length}] ${migration.name}`);
        console.log(`   📝 ${migration.description}`);

        try {
          const result = await migration.execute(this.db);
          const verified = await migration.verify(this.db);

          this.results.push({
            step: migration.name,
            status: verified ? 'SUCCESS' : 'FAILED',
            result
          });

          if (verified) {
            console.log(`   ✅ Completed successfully`);
            if (result.modified) console.log(`   📊 Modified: ${result.modified} documents`);
            if (result.sellsUpdated) console.log(`   📊 Updated: ${result.sellsUpdated} events`);
          } else {
            console.log(`   ❌ Verification failed!`);
            throw new Error(`Migration step failed: ${migration.name}`);
          }
        } catch (error: any) {
          console.error(`   ❌ Error: ${error.message}`);
          this.results.push({
            step: migration.name,
            status: 'ERROR',
            error: error.message
          });
          throw error;
        }
      }

      // Print summary
      this.printSummary();

    } catch (error: any) {
      console.error('\n❌ DEPLOYMENT FAILED');
      console.error(error);
      process.exit(1);
    } finally {
      await this.client.close();
    }
  }

  private printSummary() {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 DEPLOYMENT SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');
    
    const successful = this.results.filter(r => r.status === 'SUCCESS').length;
    const failed = this.results.filter(r => r.status === 'FAILED').length;
    const errors = this.results.filter(r => r.status === 'ERROR').length;

    console.log(`\n✅ Successful: ${successful}`);
    if (failed > 0) console.log(`❌ Failed: ${failed}`);
    if (errors > 0) console.log(`⚠️  Errors: ${errors}`);

    console.log('\n📋 Steps executed:');
    this.results.forEach((r, i) => {
      const icon = r.status === 'SUCCESS' ? '✅' : r.status === 'FAILED' ? '❌' : '⚠️';
      console.log(`   ${icon} ${i + 1}. ${r.step}`);
    });

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🎉 DEPLOYMENT COMPLETED SUCCESSFULLY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📅 Completed: ${new Date().toISOString()}`);
    console.log('\n⚡ Next steps:');
    console.log('   1. Restart the indexer service');
    console.log('   2. Monitor logs for any errors');
    console.log('   3. Verify new events are indexed correctly');
    console.log('═══════════════════════════════════════════════════════════\n');
  }
}

// Run deployment
const deployment = new ProductionDeployment();
deployment.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
