/**
 * Position Tracking Helpers
 * Utilities for maintaining user position state
 */

import { Db } from 'mongodb';

const U64_MAX = '18446744073709551615';

export class PositionTracker {
  constructor(private db: Db) {}

  /**
   * Update user position after a SHARES_PURCHASED event
   */
  async handlePurchase(params: {
    userAddress: string;
    marketId: string;
    rangeLower: bigint;
    rangeUpper: bigint;
    sharesPurchased: bigint;
    totalCost: bigint;
    timestamp: bigint;
    txDigest: string;
  }): Promise<void> {
    const { userAddress, marketId, rangeLower, rangeUpper, sharesPurchased, totalCost, timestamp, txDigest } = params;

    const avgPriceThisPurchase = Number(totalCost) / Number(sharesPurchased);

    // Upsert position
    const result = await this.db.collection('user_positions').findOneAndUpdate(
      {
        user_address: userAddress,
        market_id: marketId,
        range_lower: rangeLower,
        range_upper: rangeUpper,
      },
      {
        $inc: {
          total_shares: sharesPurchased,
          total_cost_basis: totalCost,
        },
        $set: {
          last_updated_at: timestamp,
          last_tx_digest: txDigest,
          is_active: true,
        },
        $setOnInsert: {
          first_purchase_at: timestamp,
          realized_pnl: 0n,
          total_shares_sold: 0n,
          total_proceeds: 0n,
        },
      },
      { 
        upsert: true,
        returnDocument: 'after',
      }
    );

    // Recalculate average entry price
    const position = result;
    if (position) {
      const newAvgPrice = Number(position.total_cost_basis) / Number(position.total_shares);
      
      await this.db.collection('user_positions').updateOne(
        { _id: position._id },
        { $set: { avg_entry_price: newAvgPrice } }
      );
    }

    console.log(`   💼 Position updated: +${sharesPurchased} shares @ $${avgPriceThisPurchase.toFixed(6)}`);
  }

  /**
   * Update user position after a SHARES_SOLD event
   */
  async handleSale(params: {
    userAddress: string;
    marketId: string;
    rangeLower: bigint;
    rangeUpper: bigint;
    sharesSold: bigint;
    proceeds: bigint;
    timestamp: bigint;
    txDigest: string;
    positionIndex?: number;
    isFifoSell: boolean;
  }): Promise<{ realizedPnlDelta: bigint }> {
    const { userAddress, marketId, rangeLower, rangeUpper, sharesSold, proceeds, timestamp, txDigest, isFifoSell } = params;

    // Find the position
    const position = await this.db.collection('user_positions').findOne({
      user_address: userAddress,
      market_id: marketId,
      range_lower: rangeLower,
      range_upper: rangeUpper,
    });

    if (!position) {
      console.warn(`   ⚠️  Position not found for sale (user: ${userAddress.slice(0, 10)}..., market: ${marketId.slice(0, 10)}...)`);
      return { realizedPnlDelta: 0n };
    }

    // Calculate realized PnL using weighted average cost basis
    const currentShares = BigInt(position.total_shares);
    const currentCostBasis = BigInt(position.total_cost_basis);
    
    if (currentShares < sharesSold) {
      console.warn(`   ⚠️  Attempting to sell more shares (${sharesSold}) than available (${currentShares})`);
      // Proceed anyway - blockchain is source of truth
    }

    // Calculate cost basis of shares being sold (weighted average)
    const avgCostPerShare = currentShares > 0n 
      ? Number(currentCostBasis) / Number(currentShares)
      : 0;
    const costBasisOfSold = BigInt(Math.floor(avgCostPerShare * Number(sharesSold)));
    const realizedPnl = proceeds - costBasisOfSold;

    // Update position
    const newShares = currentShares - sharesSold;
    const newCostBasis = currentCostBasis - costBasisOfSold;

    await this.db.collection('user_positions').updateOne(
      { _id: position._id },
      {
        $set: {
          total_shares: newShares,
          total_cost_basis: newCostBasis,
          avg_entry_price: newShares > 0n ? Number(newCostBasis) / Number(newShares) : 0,
          is_active: newShares > 0n,
          last_updated_at: timestamp,
          last_tx_digest: txDigest,
        },
        $inc: {
          realized_pnl: realizedPnl,
          total_shares_sold: sharesSold,
          total_proceeds: proceeds,
        },
      }
    );

    const pnlSign = realizedPnl >= 0n ? '+' : '';
    const pnlUsd = Number(realizedPnl) / 1_000_000;
    console.log(`   💰 Position updated: -${sharesSold} shares, PnL: ${pnlSign}$${pnlUsd.toFixed(2)} (${isFifoSell ? 'FIFO' : 'targeted'})`);
    
    return { realizedPnlDelta: realizedPnl };
  }

  /**
   * Update position after rewards claimed (market resolved)
   */
  async handleClaim(params: {
    userAddress: string;
    marketId: string;
    rangeLower: bigint;
    rangeUpper: bigint;
    sharesClaimed: bigint;
    payoutAmount: bigint;
    timestamp: bigint;
    txDigest: string;
  }): Promise<{ realizedPnlDelta: bigint }> {
    const { userAddress, marketId, rangeLower, rangeUpper, sharesClaimed, payoutAmount, timestamp, txDigest } = params;

    // Find the position
    const position = await this.db.collection('user_positions').findOne({
      user_address: userAddress,
      market_id: marketId,
      range_lower: rangeLower,
      range_upper: rangeUpper,
    });

    if (!position) {
      console.warn(`   ⚠️  Position not found for claim (user: ${userAddress.slice(0, 10)}..., market: ${marketId.slice(0, 10)}...)`);
      return { realizedPnlDelta: 0n };
    }

    // Move unrealized_pnl → realized_pnl (as per alignment doc State 6)
    const unrealizedPnl = BigInt(position.unrealized_pnl || 0n);
    
    // Mark position as fully closed
    await this.db.collection('user_positions').updateOne(
      { _id: position._id },
      {
        $set: {
          total_shares: 0n,
          total_cost_basis: 0n,
          avg_entry_price: 0,
          unrealized_pnl: 0n,
          is_active: false,
          close_reason: 'CLAIMED',
          last_updated_at: timestamp,
          last_tx_digest: txDigest,
        },
        $inc: {
          realized_pnl: unrealizedPnl, // Move unrealized to realized
          total_shares_sold: sharesClaimed,
          total_proceeds: payoutAmount,
        },
      }
    );

    const pnlSign = unrealizedPnl >= 0n ? '+' : '';
    const pnlUsd = Number(unrealizedPnl) / 1_000_000;
    console.log(`   🏆 Position closed: ${sharesClaimed} shares claimed, Final PnL: ${pnlSign}$${pnlUsd.toFixed(2)}`);
    
    return { realizedPnlDelta: unrealizedPnl };
  }

  /**
   * Update market cache when market is created
   */
  async cacheMarketMetadata(params: {
    marketId: string;
    marketName: string;
    category: string;
    status?: 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
    currentPrice?: bigint | null;
    resolvedValue?: bigint | null;
    minValue?: bigint;
    maxValue?: bigint;
    bucketCount?: number;
    bucketWidth?: bigint;
    resolutionTime?: bigint;
    createdAt?: bigint;
  }): Promise<void> {
    const updateFields: any = {
      market_id: params.marketId,
      market_name: params.marketName,
      category: params.category,
      status: params.status || 'ACTIVE',
      updated_at: new Date(),
    };

    // Add optional fields if provided
    if (params.currentPrice !== undefined) updateFields.current_price = params.currentPrice;
    if (params.resolvedValue !== undefined) updateFields.resolved_value = params.resolvedValue;
    if (params.minValue !== undefined) updateFields.min_value = params.minValue;
    if (params.maxValue !== undefined) updateFields.max_value = params.maxValue;
    if (params.bucketCount !== undefined) updateFields.bucket_count = params.bucketCount;
    if (params.bucketWidth !== undefined) updateFields.bucket_width = params.bucketWidth;
    if (params.resolutionTime !== undefined) updateFields.resolution_time = params.resolutionTime;
    if (params.createdAt !== undefined) updateFields.created_at = params.createdAt;

    await this.db.collection('markets_cache').updateOne(
      { market_id: params.marketId },
      { $set: updateFields },
      { upsert: true }
    );

    console.log(`   📊 Market cached: ${params.marketName}`);
  }

  /**
   * Update market cache when market is resolved
   */
  async updateMarketResolution(marketId: string, resolvedValue: bigint): Promise<void> {
    await this.db.collection('markets_cache').updateOne(
      { market_id: marketId },
      {
        $set: {
          status: 'RESOLVED',
          resolved_value: resolvedValue,
          current_price: resolvedValue,
          updated_at: new Date(),
        },
      }
    );

    console.log(`   ✅ Market cache updated: resolved at ${resolvedValue}`);
  }

  /**
   * Close losing positions (resolved value outside their range)
   * Uses bulk operation for performance - handles 100K+ positions efficiently
   */
  async closeLosingPositions(marketId: string, resolvedValue: bigint): Promise<{ modifiedCount: number }> {
    const startTime = Date.now();
    const closedTimestamp = BigInt(Date.now());
    
    // Single bulk operation - MongoDB handles internally
    const result = await this.db.collection('user_positions').updateMany(
      {
        market_id: marketId,
        is_active: true,
        $or: [
          { range_lower: { $gt: resolvedValue } },  // Range starts above resolved
          { range_upper: { $lt: resolvedValue } }   // Range ends below resolved
        ]
      },
      [
        {
          $set: {
            is_active: false,
            closed_at: closedTimestamp,
            last_updated_at: closedTimestamp,
            close_reason: 'LOST_RESOLUTION',
            // Calculate 100% loss: unrealized_pnl = -total_cost_basis
            unrealized_pnl: { $multiply: [{ $toLong: '$total_cost_basis' }, -1] }
          }
        }
      ]
    );

    const duration = Date.now() - startTime;
    console.log(`   💀 Closed ${result.modifiedCount} losing positions (${duration}ms)`);
    
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Calculate unrealized PnL for winning positions (resolved value in their range)
   * Positions stay active until user claims
   * 
   * IMPORTANT: In prediction markets, 1 winning share pays out 1 USDC.
   * Both total_shares and total_cost_basis are already stored in micro-units (6 decimals).
   * Therefore: 1 micro-share = 1 micro-USDC payout at resolution.
   * No conversion needed - direct subtraction.
   */
  async calculateWinningPositions(marketId: string, resolvedValue: bigint): Promise<{ modifiedCount: number }> {
    const startTime = Date.now();
    
    // Find winning positions (resolved value within range)
    const result = await this.db.collection('user_positions').updateMany(
      {
        market_id: marketId,
        is_active: true,
        range_lower: { $lte: resolvedValue },
        range_upper: { $gte: resolvedValue }
      },
      [
        {
          $set: {
            // Both values already in micro-units (6 decimals precision)
            // 1 micro-share pays 1 micro-USDC when user wins
            // unrealized_pnl = total_shares - total_cost_basis
            unrealized_pnl: {
              $subtract: [
                { $toLong: '$total_shares' },
                { $toLong: '$total_cost_basis' }
              ]
            }
            // is_active stays true until claimed
          }
        }
      ]
    );

    const duration = Date.now() - startTime;
    console.log(`   🏆 Updated ${result.modifiedCount} winning positions (${duration}ms)`);
    
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Helper: Check if position_index is FIFO mode
   */
  static isFifoSell(positionIndex: string | number | undefined): boolean {
    if (positionIndex === undefined || positionIndex === null) return false;
    return positionIndex.toString() === U64_MAX;
  }
}
