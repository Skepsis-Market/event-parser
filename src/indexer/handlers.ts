import { Db } from 'mongodb';
import axios from 'axios';
import CONFIG from '../config/env';

export class EventHandlers {
  constructor(private db: Db) {}
  
  async handleBetPlaced(event: any, eventId: any): Promise<void> {
    try {
      await this.db.collection('trades').insertOne({
        user: event.user,
        market_id: event.market_id,
        action: 'BUY',
        range: {
          start: BigInt(event.range_start),
          end: BigInt(event.range_end)
        },
        shares: BigInt(event.shares_received),
        amount: BigInt(event.bet_amount),
        probability: BigInt(event.probability_at_purchase || 0),
        price_per_share: BigInt(event.price_per_share),
        tx_hash: eventId.txDigest,
        block_number: BigInt(eventId.eventSeq),
        timestamp: BigInt(event.timestamp || Date.now()),
        indexed_at: new Date()
      });
      
      console.log(`✅ BetPlaced indexed: ${event.user} on ${event.market_id}`);
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
      // Log raw event for debugging
      console.log(`📊 SharesSold event data:`, {
        user: event.user,
        market_id: event.market_id,
        shares_sold: event.shares_sold,
        amount_received: event.amount_received,
        tx: eventId.txDigest.slice(0, 10)
      });

      await this.db.collection('trades').insertOne({
        user: event.user,
        market_id: event.market_id,
        action: 'SELL',
        range: {
          start: BigInt(event.range_start),
          end: BigInt(event.range_end)
        },
        shares: BigInt(event.shares_sold),
        amount: BigInt(event.amount_received),
        price_per_share: BigInt(event.price_per_share),
        tx_hash: eventId.txDigest,
        block_number: BigInt(eventId.eventSeq),
        timestamp: BigInt(event.timestamp || Date.now()),
        indexed_at: new Date()
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
      // Insert CLAIM trade
      await this.db.collection('trades').insertOne({
        user: event.user,
        market_id: event.market_id,
        action: 'CLAIM',
        range: {
          start: BigInt(event.range_start),
          end: BigInt(event.range_end)
        },
        shares: BigInt(event.shares_claimed),
        amount: BigInt(event.payout_amount),
        price_per_share: BigInt(1_000_000), // $1 per share
        tx_hash: eventId.txDigest,
        block_number: BigInt(eventId.eventSeq),
        timestamp: BigInt(event.timestamp || Date.now()),
        indexed_at: new Date()
      });
      
      console.log(`✅ WinningsClaimed indexed: ${event.user} on ${event.market_id}`);
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
      
      await axios.patch(
        apiUrl,
        {
          status: 'resolved',
          resolvedValue: Number(event.resolution_value)
        },
        { 
          headers: { 
            'Content-Type': 'application/json',
            'x-admin-secret': CONFIG.adminSecret
          },
          timeout: 5000
        }
      );
      
      console.log(`✅ MarketResolved synced to API: ${event.market_id} → ${event.resolution_value}`);
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
}
