import { SuiClient } from '@mysten/sui/client';
import { Db } from 'mongodb';
import { EventHandlers } from './handlers';
import { EVENT_TYPES } from '../sui/client';

export class EventPoller {
  private handlers: EventHandlers;
  private isRunning = false;
  private cursors: Map<string, any> = new Map(); // Separate cursor per event type
  
  constructor(
    private suiClient: SuiClient,
    private db: Db
  ) {
    this.handlers = new EventHandlers(db);
  }
  
  async start(): Promise<void> {
    console.log(`🚀 Starting event poller (HTTP polling mode)...`);
    this.isRunning = true;
    
    await this.poll();
  }
  
  stop(): void {
    this.isRunning = false;
    console.log('⏹️  Event poller stopped');
  }
  
  private async poll(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.fetchAndProcessEvents();
        
        // Wait 2 seconds before next poll
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error('❌ Error in event polling:', error);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Backoff 5s
      }
    }
  }
  
  private async fetchAndProcessEvents(): Promise<void> {
    let hasNewEvents = false;
    
    // Query all event types (each with its own cursor)
    for (const [name, eventType] of Object.entries(EVENT_TYPES)) {
      try {
        const eventCursor = this.cursors.get(name) || null;
        
        const result = await this.suiClient.queryEvents({
          query: { MoveEventType: eventType },
          cursor: eventCursor,
          limit: 50,
          order: 'ascending'
        });
        
        if (result.data.length > 0) {
          console.log(`\n📦 Found ${result.data.length} ${name} events`);
          
          for (const event of result.data) {
            await this.processEvent(name, event);
            hasNewEvents = true;
          }
          
          // Update cursor for this specific event type
          if (result.nextCursor) {
            this.cursors.set(name, result.nextCursor);
          }
        }
      } catch (error) {
        console.error(`❌ Error fetching ${name} events:`, error);
      }
    }
    
    if (!hasNewEvents) {
      process.stdout.write('.');
    }
  }
  
  private async processEvent(eventName: string, event: any): Promise<void> {
    const eventData = event.parsedJson;
    const eventId = event.id;
    
    console.log(`\n📥 ${eventName} (tx: ${eventId.txDigest.slice(0, 10)}...)`);
    
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
