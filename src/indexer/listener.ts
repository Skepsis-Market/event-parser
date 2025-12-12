import { SuiClient } from '@mysten/sui/client';
import { Db } from 'mongodb';
import { EventHandlers } from './handlers';
import { EVENT_TYPES } from '../sui/client';

export class EventListener {
  private handlers: EventHandlers;
  private isRunning = false;
  private subscriptions: Map<string, Promise<() => Promise<boolean>>> = new Map();
  
  constructor(
    private suiClient: SuiClient,
    private db: Db
  ) {
    this.handlers = new EventHandlers(db);
  }
  
  async start(): Promise<void> {
    console.log(`🚀 Starting WebSocket event listener...`);
    this.isRunning = true;
    
    // Subscribe to each event type
    for (const [name, eventType] of Object.entries(EVENT_TYPES)) {
      await this.subscribeToEvent(name, eventType);
    }
    
    console.log(`✅ Subscribed to ${this.subscriptions.size} event types`);
    console.log(`📡 Listening for events...\n`);
  }
  
  async stop(): Promise<void> {
    console.log('\n⏹️  Stopping event listener...');
    this.isRunning = false;
    
    // Unsubscribe from all events
    for (const [name, unsubPromise] of this.subscriptions.entries()) {
      try {
        const unsubscribe = await unsubPromise;
        await unsubscribe();
        console.log(`   ✓ Unsubscribed from ${name}`);
      } catch (error) {
        console.error(`   ✗ Error unsubscribing from ${name}:`, error);
      }
    }
    
    this.subscriptions.clear();
    console.log('⏹️  Event listener stopped');
  }
  
  private async subscribeToEvent(eventName: string, eventType: string): Promise<void> {
    try {
      const unsubscribePromise = this.suiClient.subscribeEvent({
        filter: { MoveEventType: eventType },
        onMessage: async (event) => {
          if (!this.isRunning) return;
          
          try {
            await this.processEvent(eventName, event);
          } catch (error) {
            console.error(`❌ Error processing ${eventName}:`, error);
          }
        }
      });
      
      this.subscriptions.set(eventName, unsubscribePromise);
      console.log(`   ✓ Subscribed to ${eventName}`);
    } catch (error) {
      console.error(`❌ Failed to subscribe to ${eventName}:`, error);
      throw error;
    }
  }
  
  private async processEvent(eventName: string, event: any): Promise<void> {
    const eventData = event.parsedJson;
    const eventId = event.id;
    
    // Route to appropriate handler
    switch (eventName) {
      case 'BET_PLACED':
        await this.handlers.handleBetPlaced(eventData, eventId);
        break;
      case 'SHARES_SOLD':
        await this.handlers.handleSharesSold(eventData, eventId);
        break;
      case 'WINNINGS_CLAIMED':
        await this.handlers.handleWinningsClaimed(eventData, eventId);
        break;
      case 'MARKET_RESOLVED':
        await this.handlers.handleMarketResolved(eventData, eventId);
        break;
      case 'MARKET_CREATED':
        await this.handlers.handleMarketCreated(eventData, eventId);
        break;
    }
    
    // Update last processed event
    await this.saveLastEvent(eventId);
  }
  
  private async saveLastEvent(eventId: any): Promise<void> {
    await this.db.collection('indexer_state').updateOne(
      { _id: 'last_event' } as any,
      { 
        $set: { 
          tx_digest: eventId.txDigest,
          event_seq: eventId.eventSeq,
          updated_at: new Date() 
        } 
      },
      { upsert: true }
    );
  }
}
