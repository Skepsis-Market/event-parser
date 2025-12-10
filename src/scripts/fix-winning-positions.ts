/**
 * Fix Broken Unrealized PnL for Winning Positions
 * 
 * This script fixes positions where unrealized_pnl was incorrectly calculated
 * by multiplying shares by 1e6 instead of treating them as already in micro-units.
 * 
 * Run this once after deploying the corrected position resolution logic.
 */

import { MongoClient } from 'mongodb';
import CONFIG from '../config/env';

async function fixWinningPositions() {
  console.log('🔧 Fixing unrealized PnL for winning positions...\n');

  const client = new MongoClient(CONFIG.mongodbUri);
  await client.connect();
  const db = client.db(CONFIG.mongodbDb);

  try {
    // Find all resolved markets
    const resolvedMarkets = await db.collection('markets')
      .find({ status: 'resolved' })
      .project({ marketId: 1, resolvedValue: 1, 'configuration.marketName': 1 })
      .toArray();

    console.log(`📊 Found ${resolvedMarkets.length} resolved markets\n`);

    let totalFixed = 0;
    let totalChecked = 0;

    for (const market of resolvedMarkets) {
      const { marketId, resolvedValue } = market;
      const marketName = market.configuration?.marketName || 'Unnamed';

      // Find winning positions (range contains resolved value)
      const winningPositions = await db.collection('user_positions').find({
        market_id: marketId,
        is_active: true,
        range_lower: { $lte: resolvedValue },
        range_upper: { $gte: resolvedValue }
      }).toArray();

      if (winningPositions.length === 0) continue;

      console.log(`\n🎯 ${marketName}`);
      console.log(`   Market: ${marketId.slice(0, 10)}...`);
      console.log(`   Resolved at: ${resolvedValue}`);
      console.log(`   Winning positions: ${winningPositions.length}`);

      for (const pos of winningPositions) {
        totalChecked++;

        const totalShares = BigInt(pos.total_shares);
        const totalCostBasis = BigInt(pos.total_cost_basis);
        const currentUnrealizedPnl = BigInt(pos.unrealized_pnl || 0);

        // Correct calculation: shares are already in micro-units
        const correctUnrealizedPnl = totalShares - totalCostBasis;

        // Check if it's wrong (off by factor of 1e6 or more)
        const difference = currentUnrealizedPnl > correctUnrealizedPnl 
          ? currentUnrealizedPnl - correctUnrealizedPnl
          : correctUnrealizedPnl - currentUnrealizedPnl;

        // If difference is significant (more than 10% or involves the 1e6 multiplication)
        if (difference > (correctUnrealizedPnl / 10n) || 
            currentUnrealizedPnl === (totalShares * 1000000n - totalCostBasis)) {
          
          console.log(`   ⚠️  Fixing position: ${pos.user_address.slice(0, 10)}...`);
          console.log(`      Range: ${pos.range_lower} - ${pos.range_upper}`);
          console.log(`      Shares: ${totalShares.toString()}`);
          console.log(`      Cost: ${totalCostBasis.toString()}`);
          console.log(`      Wrong PnL: ${currentUnrealizedPnl.toString()}`);
          console.log(`      Correct PnL: ${correctUnrealizedPnl.toString()}`);

          // Update with correct value
          await db.collection('user_positions').updateOne(
            { _id: pos._id },
            { 
              $set: { 
                unrealized_pnl: correctUnrealizedPnl,
                fixed_at: new Date(),
                fix_reason: 'Corrected micro-unit calculation'
              } 
            }
          );

          totalFixed++;
        }
      }
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Fix Summary:`);
    console.log(`   Markets checked: ${resolvedMarkets.length}`);
    console.log(`   Positions checked: ${totalChecked}`);
    console.log(`   Positions fixed: ${totalFixed}`);
    console.log(`${'='.repeat(60)}\n`);

    if (totalFixed > 0) {
      console.log(`✅ Successfully fixed ${totalFixed} winning positions`);
      console.log(`\n💡 Tip: Restart your indexer to ensure new resolutions use correct logic`);
    } else {
      console.log(`✅ No positions needed fixing - all calculations are correct!`);
    }

  } catch (error: any) {
    console.error('❌ Fatal error during fix:', error);
    throw error;
  } finally {
    await client.close();
    process.exit(0);
  }
}

// Run if executed directly
if (require.main === module) {
  fixWinningPositions().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { fixWinningPositions };
