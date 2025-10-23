import { Db } from 'mongodb';

/**
 * Reconcile all positions for a resolved market
 */
export async function reconcileMarketPositions(
  db: Db,
  marketId: string,
  resolutionValue: bigint
): Promise<void> {
  console.log(`\n🔄 [Reconciliation] Starting for market ${marketId}`);
  console.log(`   Resolution value: ${resolutionValue}`);
  
  // 1. Get all trades for this market, sorted by timestamp
  const trades = await db.collection('trades')
    .find({ market_id: marketId })
    .sort({ timestamp: 1 })
    .toArray();
  
  if (trades.length === 0) {
    console.log('   ⚠️  No trades found for this market');
    return;
  }
  
  console.log(`   📊 Found ${trades.length} trades`);
  
  // 2. Group trades by (user, range)
  const positionMap = new Map<string, any[]>();
  
  for (const trade of trades) {
    const key = `${trade.user}:${trade.range.start}:${trade.range.end}`;
    if (!positionMap.has(key)) {
      positionMap.set(key, []);
    }
    positionMap.get(key)!.push(trade);
  }
  
  console.log(`   👥 Found ${positionMap.size} unique positions`);
  
  // 3. Calculate and upsert positions
  const bulkOps = [];
  
  for (const [key, userTrades] of positionMap.entries()) {
    const [user, rangeStart, rangeEnd] = key.split(':');
    const position = calculateFinalPosition(
      userTrades,
      BigInt(rangeStart),
      BigInt(rangeEnd),
      resolutionValue
    );
    
    bulkOps.push({
      updateOne: {
        filter: {
          user,
          market_id: marketId,
          'range.start': position.range.start,
          'range.end': position.range.end
        },
        update: {
          $set: {
            ...position,
            last_updated: new Date()
          }
        },
        upsert: true
      }
    });
  }
  
  // Bulk upsert all positions
  if (bulkOps.length > 0) {
    const result = await db.collection('positions').bulkWrite(bulkOps);
    console.log(`   ✅ Upserted ${result.upsertedCount + result.modifiedCount} positions`);
  }
  
  console.log(`✅ [Reconciliation] Completed for market ${marketId}\n`);
}

/**
 * Calculate final position from trades
 */
function calculateFinalPosition(
  trades: any[],
  rangeStart: bigint,
  rangeEnd: bigint,
  resolutionValue: bigint
): any {
  let totalSharesBought = 0n;
  let totalSharesSold = 0n;
  let totalInvested = 0n;
  let totalReceivedSells = 0n;
  let claimAmount = 0n;
  
  for (const trade of trades) {
    const shares = BigInt(trade.shares);
    const amount = BigInt(trade.amount);
    
    if (trade.action === 'BUY') {
      totalSharesBought += shares;
      totalInvested += amount;
    } else if (trade.action === 'SELL') {
      totalSharesSold += shares;
      totalReceivedSells += amount;
    } else if (trade.action === 'CLAIM') {
      claimAmount += amount;
    }
  }
  
  const finalShares = totalSharesBought - totalSharesSold;
  const isWinning = resolutionValue >= rangeStart && resolutionValue <= rangeEnd;
  
  // Determine status and realized PnL
  let status: string;
  let realizedPnL: bigint;
  
  if (claimAmount > 0n) {
    status = 'CLAIMED';
    realizedPnL = (totalReceivedSells + claimAmount) - totalInvested;
  } else if (finalShares === 0n) {
    status = 'SOLD';
    realizedPnL = totalReceivedSells - totalInvested;
  } else if (isWinning) {
    status = 'WINNING';
    const potentialPayout = finalShares * 1_000_000n; // $1 per share in micro-units
    realizedPnL = (totalReceivedSells + potentialPayout) - totalInvested;
  } else {
    status = 'LOSING';
    realizedPnL = totalReceivedSells - totalInvested; // Lost all unclaimed shares
  }
  
  // Calculate average entry price
  const avgEntryPrice = totalSharesBought > 0n
    ? (totalInvested * 1_000_000n) / totalSharesBought
    : 0n;
  
  return {
    user: trades[0].user,
    market_id: trades[0].market_id,
    range: {
      start: rangeStart.toString(),
      end: rangeEnd.toString()
    },
    trade_summary: {
      total_shares_bought: totalSharesBought.toString(),
      total_shares_sold: totalSharesSold.toString(),
      final_shares: finalShares.toString()
    },
    financial: {
      total_invested: totalInvested.toString(),
      total_received_sells: totalReceivedSells.toString(),
      claim_amount: claimAmount.toString(),
      realized_pnl: realizedPnL.toString(),
      avg_entry_price: avgEntryPrice.toString()
    },
    status,
    resolved_at: Date.now().toString(),
    reconciled_at: Date.now().toString()
  };
}
