import { Db } from 'mongodb';
import axios from 'axios';
import CONFIG from '../config/env';
import { resolutionScheduler } from '../scheduler/resolution-scheduler';
import { PositionTracker } from '../database/position-tracker';

export class EventHandlers {
  private positionTracker: PositionTracker;
  
  constructor(private db: Db) {
    this.positionTracker = new PositionTracker(db);
  }
  
  async handleBetPlaced(event: any, eventId: any): Promise<void> {
    try {
      // Use blockchain timestamp (milliseconds) from event envelope
      const timestamp = BigInt(eventId.timestampMs || Date.now());
      const rangeLower = BigInt(event.range_start);
      const rangeUpper = BigInt(event.range_end);
      const sharesPurchased = BigInt(event.shares_received);
      const totalCost = BigInt(event.bet_amount);
      
      // 1. Insert into legacy trades collection (backwards compatibility)
      await this.db.collection('trades').insertOne({
        user: event.user,
        market_id: event.market_id,
        action: 'BUY',
        range: {
          start: rangeLower,
          end: rangeUpper
        },
        shares: sharesPurchased,
        amount: totalCost,
        probability: BigInt(event.probability_at_purchase || 0),
        price_per_share: BigInt(event.price_per_share),
        tx_hash: eventId.txDigest,
        block_number: BigInt(eventId.eventSeq),
        timestamp: timestamp,
        indexed_at: new Date()
      });
      
      // 2. Insert into position_events (immutable ledger)
      await this.db.collection('position_events').insertOne({
        tx_digest: eventId.txDigest,
        checkpoint: BigInt(eventId.checkpoint || eventId.eventSeq || 0),
        timestamp: timestamp,
        event_type: 'SHARES_SOLD',
        user_address: event.user,
        position_store_id: event.position_store_id || null,
        market_id: event.market_id,
        range_lower: rangeLower,
        range_upper: rangeUpper,
        shares_delta: sharesPurchased,
        usdc_delta: -totalCost, // Negative = paid out
        price_per_share: BigInt(event.price_per_share),
        indexed_at: new Date()
      });
      
      // 3. Update user_positions (aggregated state)
      await this.positionTracker.handlePurchase({
        userAddress: event.user,
        marketId: event.market_id,
        rangeLower,
        rangeUpper,
        sharesPurchased,
        totalCost,
        timestamp,
        txDigest: eventId.txDigest
      });
      
      console.log(`✅ BetPlaced indexed: ${event.user.slice(0, 10)}... on ${event.market_id.slice(0, 10)}...`);
    } catch (error: any) {
      if (error.code === 11000) {
        console.log(`⚠️  Duplicate BetPlaced event (tx: ${eventId.txDigest})`);
      } else {
        throw error;
      }
    }
  }
  
  async handleSharesSold(event: any, eventId: any): Promise<void> {
    try {
      // Use blockchain timestamp (milliseconds) from event envelope
      const timestamp = BigInt(eventId.timestampMs || Date.now());
      const rangeLower = BigInt(event.range_start);
      const rangeUpper = BigInt(event.range_end);
      const sharesSold = BigInt(event.shares_sold);
      const proceeds = BigInt(event.amount_received);
      const positionIndex = event.position_index;
      const isFifoSell = PositionTracker.isFifoSell(positionIndex);
      
      console.log(`📊 SharesSold event:`, {
        user: event.user.slice(0, 10),
        market: event.market_id.slice(0, 10),
        shares: sharesSold.toString(),
        proceeds: proceeds.toString(),
        mode: isFifoSell ? 'FIFO' : `Index ${positionIndex}`,
        tx: eventId.txDigest.slice(0, 10)
      });

      // 1. Insert into legacy trades collection
      await this.db.collection('trades').insertOne({
        user: event.user,
        market_id: event.market_id,
        action: 'SELL',
        range: {
          start: rangeLower,
          end: rangeUpper
        },
        shares: sharesSold,
        amount: proceeds,
        price_per_share: BigInt(event.price_per_share),
        tx_hash: eventId.txDigest,
        block_number: BigInt(eventId.eventSeq),
        timestamp: timestamp,
        indexed_at: new Date()
      });
      
      // 2. Insert into position_events
      await this.db.collection('position_events').insertOne({
        tx_digest: eventId.txDigest,
        checkpoint: BigInt(eventId.eventSeq),
        timestamp: timestamp,
        event_type: 'SHARES_SOLD',
        user_address: event.user,
        position_store_id: event.position_store_id || null,
        market_id: event.market_id,
        range_lower: rangeLower,
        range_upper: rangeUpper,
        shares_delta: -sharesSold, // Negative
        usdc_delta: proceeds, // Positive = received
        price_per_share: BigInt(event.price_per_share),
        position_index: isFifoSell ? null : Number(positionIndex),
        is_fifo_sell: isFifoSell,
        indexed_at: new Date()
      });
      
      // 3. Update user_positions
      await this.positionTracker.handleSale({
        userAddress: event.user,
        marketId: event.market_id,
        rangeLower,
        rangeUpper,
        sharesSold,
        proceeds,
        timestamp,
        txDigest: eventId.txDigest,
        positionIndex: isFifoSell ? undefined : Number(positionIndex),
        isFifoSell
      });
      
      console.log(`✅ SharesSold indexed: ${event.user.slice(0, 10)}... on ${event.market_id.slice(0, 10)}...`);
    } catch (error: any) {
      if (error.code === 11000) {
        console.log(`⚠️  Duplicate SharesSold event (tx: ${eventId.txDigest})`);
      } else {
        console.error(`❌ SharesSold handler error:`, error);
        console.error(`   Event data:`, event);
        throw error;
      }
    }
  }
  
  async handleWinningsClaimed(event: any, eventId: any): Promise<void> {
    try {
      // Use blockchain timestamp (milliseconds) from event envelope
      const timestamp = BigInt(eventId.timestampMs || Date.now());
      const rangeLower = BigInt(event.range_start);
      const rangeUpper = BigInt(event.range_end);
      const sharesClaimed = BigInt(event.shares_claimed);
      const payoutAmount = BigInt(event.payout_amount);
      
      // 1. Insert CLAIM trade (legacy)
      await this.db.collection('trades').insertOne({
        user: event.user,
        market_id: event.market_id,
        action: 'CLAIM',
        range: {
          start: rangeLower,
          end: rangeUpper
        },
        shares: sharesClaimed,
        amount: payoutAmount,
        price_per_share: BigInt(1_000_000), // $1 per share
        tx_hash: eventId.txDigest,
        block_number: BigInt(eventId.eventSeq),
        timestamp: timestamp,
        indexed_at: new Date()
      });
      
      // 2. Insert into position_events
      await this.db.collection('position_events').insertOne({
        tx_digest: eventId.txDigest,
        checkpoint: BigInt(eventId.checkpoint || eventId.eventSeq || 0),
        timestamp: timestamp,
        event_type: 'REWARDS_CLAIMED',
        user_address: event.user,
        position_store_id: event.position_store_id || null,
        market_id: event.market_id,
        range_lower: rangeLower,
        range_upper: rangeUpper,
        shares_delta: -sharesClaimed, // Shares removed
        usdc_delta: payoutAmount, // Payout received
        price_per_share: BigInt(1_000_000),
        indexed_at: new Date()
      });
      
      // 3. Update user_positions (close position)
      await this.positionTracker.handleClaim({
        userAddress: event.user,
        marketId: event.market_id,
        rangeLower,
        rangeUpper,
        sharesClaimed,
        payoutAmount,
        timestamp,
        txDigest: eventId.txDigest
      });
      
      console.log(`✅ WinningsClaimed indexed: ${event.user.slice(0, 10)}... on ${event.market_id.slice(0, 10)}...`);
    } catch (error: any) {
      if (error.code === 11000) {
        console.log(`⚠️  Duplicate WinningsClaimed event (tx: ${eventId.txDigest})`);
      } else {
        throw error;
      }
    }
  }

  async handleMarketResolved(event: any, eventId: any): Promise<void> {
    try {
      // Sync resolution to backend API
      const apiUrl = `${CONFIG.apiBaseUrl}/api/markets/${event.market_id}/status`;

      // V12 contract emits 'winning_outcome', older versions used 'resolution_value'
      const resolvedValueRaw = event.winning_outcome ?? event.resolution_value ?? event.resolved_value ?? event.value ?? event.result_value;
      const resolvedValue = resolvedValueRaw !== undefined ? Number(resolvedValueRaw) : undefined;
      
      if (resolvedValue === undefined || Number.isNaN(resolvedValue)) {
        console.warn(`⚠️  MarketResolved event missing resolution value:`, event);
        return;
      }
      
      // Update markets_cache with resolution
      await this.positionTracker.updateMarketResolution(
        event.market_id,
        BigInt(resolvedValue)
      );
      
      await axios.patch(
        apiUrl,
        {
          status: 'resolved',
          resolvedValue
        },
        { 
          headers: { 
            'Content-Type': 'application/json',
            'x-admin-secret': CONFIG.adminSecret
          },
          timeout: 5000
        }
      );
      
      console.log(`✅ MarketResolved synced to API: ${event.market_id} → ${resolvedValue}`);
    } catch (error: any) {
      if (error.response) {
        console.error(`⚠️  API sync failed (${error.response.status}): ${error.message}`);
      } else if (error.request) {
        console.error(`⚠️  API unreachable: ${error.message}`);
      } else {
        console.error(`⚠️  MarketResolved error: ${error.message}`);
      }
      // Don't throw - market is resolved on-chain regardless of API sync
    }
  }

  async handleMarketCreated(event: any, eventId: any): Promise<void> {
    try {
      const marketId = event.market_id;
      const resolutionTime = Number(event.resolution_time);
      
      console.log(`📅 MarketCreated event detected:`);
      console.log(`   Market ID: ${marketId}`);
      console.log(`   Resolution Time: ${new Date(resolutionTime).toISOString()}`);
      
      // 1. Sync to markets_cache for fast position queries
      await this.positionTracker.cacheMarketMetadata({
        marketId: marketId,
        marketName: event.market_name || event.name || 'Unnamed Market',
        category: event.category || 'General',
        status: 'ACTIVE',
        currentPrice: null,
        resolvedValue: null
      });
      
      // 2. Store in MongoDB with duplicate check
      try {
        await this.db.collection('scheduled_resolutions').insertOne({
          marketId: marketId,
          resolutionTime: resolutionTime,
          status: 'pending',
          createdAt: new Date(),
          lastAttempt: null,
          error: null,
          tx_hash: eventId.txDigest,
          indexed_at: new Date()
        });
        
        console.log(`   ✅ Stored in MongoDB: scheduled_resolutions`);
      } catch (error: any) {
        if (error.code === 11000) {
          console.log(`   ⚠️  Already scheduled (duplicate event)`);
          return; // Skip scheduling if already exists
        } else {
          throw error;
        }
      }
      
      // 3. Schedule automatic resolution
      resolutionScheduler.scheduleMarketResolution(marketId, resolutionTime);
      
    } catch (error: any) {
      console.error(`⚠️  Failed to handle MarketCreated: ${error.message}`);
      // Don't throw - this is not critical for indexing
    }
  }
}
