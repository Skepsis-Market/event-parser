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
    
    // Initialize cursors to latest checkpoint to skip historical events
    await this.initializeCursors();
    
    this.isRunning = true;
    await this.poll();
  }
  
  /**
   * Initialize cursors from saved state in DB
   * Strategy: Restore last cursor position per event type, or skip to latest if no state
   */
  private async initializeCursors(): Promise<void> {
    console.log('🔍 Initializing event cursors...');
    
    // Try to restore saved cursors from DB
    const savedState = await this.db.collection('poller_cursors').find({}).toArray();
    
    if (savedState.length > 0) {
      console.log('   📌 Restoring saved cursor positions:');
      for (const state of savedState) {
        if (state.cursor) {
          this.cursors.set(state.eventType, state.cursor);
          console.log(`   ✓ ${state.eventType}: resumed from saved position`);
        }
      }
      console.log('');
      return;
    }
    
    // No saved state - skip to latest to avoid reprocessing history
    console.log('   ℹ️  No saved cursor state found');
    console.log('   🚀 Skipping to latest checkpoint to avoid reprocessing history...\n');
    
    for (const [name, eventType] of Object.entries(EVENT_TYPES)) {
      try {
        const result = await this.suiClient.queryEvents({
          query: { MoveEventType: eventType },
          limit: 1,
          order: 'descending'
        });
        
        if (result.nextCursor) {
          this.cursors.set(name, result.nextCursor);
          console.log(`   ✓ ${name}: cursor set to latest`);
        }
      } catch (error) {
        // Event type has no history yet
      }
    }
    console.log('');
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
            
            // Save cursor to DB for crash recovery
            await this.saveCursor(name, result.nextCursor);
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
  
  /**
   * Save cursor position to DB for crash recovery
   */
  private async saveCursor(eventType: string, cursor: any): Promise<void> {
    try {
      await this.db.collection('poller_cursors').updateOne(
        { eventType },
        { 
          $set: { 
            cursor,
            updated_at: new Date()
          }
        },
        { upsert: true }
      );
    } catch (error) {
      // Non-critical, don't throw
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
