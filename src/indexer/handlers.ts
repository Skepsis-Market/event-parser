import { Db } from 'mongodb';

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
      
      console.log(`✅ SharesSold indexed: ${event.user} on ${event.market_id}`);
    } catch (error: any) {
      if (error.code === 11000) {
        console.log(`⚠️  Duplicate SharesSold event (tx: ${eventId.txDigest})`);
      } else {
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
}
