/**
 * Resolution Scheduler
 * Manages scheduled market resolutions using node-schedule
 */

import * as schedule from 'node-schedule';
import axios from 'axios';
import { Db } from 'mongodb';
import CONFIG from '../config/env';
import { fetchPriceFromFeed, validatePrice } from './price-fetcher';
import { resolveMarket } from './market-resolver';

interface MarketData {
  marketId: string;
  configuration: {
    minValue: number;
    maxValue: number;
    resolutionTime: number;
    decimalPrecision?: number;
  };
  priceFeed: string;
  marketType: string;
  status: string;
}

class ResolutionScheduler {
  private scheduledJobs: Map<string, schedule.Job> = new Map();
  private db: Db | null = null;
  
  /**
   * Initialize scheduler with database connection
   */
  async initialize(db: Db): Promise<void> {
    this.db = db;
    console.log('\n🔄 Initializing Resolution Scheduler...');
    
    // Create index on marketId for fast lookups
    await db.collection('scheduled_resolutions').createIndex({ marketId: 1 }, { unique: true });
    
    // Load and schedule pending resolutions from MongoDB
    await this.loadPendingResolutions();
    
    console.log(`✅ Resolution Scheduler initialized with ${this.scheduledJobs.size} scheduled jobs\n`);
  }
  
  /**
   * Load pending resolutions from MongoDB and schedule them
   */
  private async loadPendingResolutions(): Promise<void> {
    if (!this.db) {
      throw new Error('Scheduler not initialized with database');
    }
    
    try {
      const pendingResolutions = await this.db.collection('scheduled_resolutions')
        .find({ status: 'pending' })
        .toArray();
      
      console.log(`📋 Found ${pendingResolutions.length} pending resolutions in MongoDB`);
      
      for (const resolution of pendingResolutions) {
        const marketId = resolution.marketId;
        const resolutionTime = resolution.resolutionTime;
        
        // Schedule the job
        this.scheduleMarketResolution(marketId, resolutionTime);
      }
      
    } catch (error: any) {
      console.error(`❌ Failed to load pending resolutions: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Schedule a market for automatic resolution
   */
  scheduleMarketResolution(marketId: string, resolutionTime: number): void {
    // Check if already scheduled
    if (this.scheduledJobs.has(marketId)) {
      console.log(`⚠️  Market ${marketId.slice(0, 10)}... already scheduled`);
      return;
    }
    
    const resolutionDate = new Date(resolutionTime);
    const now = new Date();
    
    // If resolution time has passed, resolve immediately
    if (resolutionDate <= now) {
      console.log(`⚡ Market ${marketId.slice(0, 10)}... is overdue, resolving immediately...`);
      this.executeResolution(marketId).catch(console.error);
      return;
    }
    
    // Schedule for future
    const job = schedule.scheduleJob(resolutionDate, async () => {
      console.log(`\n⏰ Scheduled resolution triggered for market: ${marketId.slice(0, 10)}...`);
      await this.executeResolution(marketId);
      this.scheduledJobs.delete(marketId);
    });
    
    this.scheduledJobs.set(marketId, job);
    
    const timeUntil = resolutionDate.getTime() - now.getTime();
    const hoursUntil = (timeUntil / (1000 * 60 * 60)).toFixed(2);
    
    console.log(`📅 Scheduled market resolution:`);
    console.log(`   Market: ${marketId.slice(0, 10)}...`);
    console.log(`   Time: ${resolutionDate.toISOString()}`);
    console.log(`   In: ${hoursUntil} hours`);
  }
  
  /**
   * Execute market resolution workflow
   */
  private async executeResolution(marketId: string): Promise<void> {
    try {
      console.log(`\n🎯 Executing resolution for market: ${marketId}`);
      console.log(`═══════════════════════════════════════════════`);
      
      // Update MongoDB: mark as in-progress
      if (this.db) {
        await this.db.collection('scheduled_resolutions').updateOne(
          { marketId: marketId },
          { 
            $set: { 
              lastAttempt: new Date(),
              status: 'in-progress'
            } 
          }
        );
      }
      
      // Step 1: Fetch market data from backend
      console.log('📊 Step 1/4: Fetching market data from API...');
      const marketData = await this.fetchMarketData(marketId);
      
      // Step 2: Check if already resolved
      if (marketData.status === 'resolved') {
        console.log(`⚠️  Market already resolved, skipping...`);
        
        // Update MongoDB: mark as resolved
        if (this.db) {
          await this.db.collection('scheduled_resolutions').updateOne(
            { marketId: marketId },
            { $set: { status: 'resolved' } }
          );
        }
        return;
      }
      
      // Step 3: Fetch current price
      console.log('💹 Step 2/4: Fetching price from feed...');
      console.log(`   Feed URL: ${marketData.priceFeed}`);
      
      const { price: rawPrice, timestamp } = await fetchPriceFromFeed(marketData.priceFeed);
      
      const decimalPrecision = marketData.configuration.decimalPrecision || 0;
      const scalingFactor = Math.pow(10, decimalPrecision);
      const scaledPrice = Math.floor(rawPrice * scalingFactor);
      
      console.log(`   Raw Price: $${rawPrice.toFixed(decimalPrecision)}`);
      console.log(`   Scaled Price: ${scaledPrice} (precision: ${decimalPrecision})`);
      console.log(`   Timestamp: ${new Date(timestamp).toISOString()}`);
      
      // Step 4: Validate price is in range
      console.log('✅ Step 3/4: Validating price...');
      const { minValue, maxValue } = marketData.configuration;
      
      if (!validatePrice(scaledPrice, minValue, maxValue)) {
        const minDisplay = (minValue / scalingFactor).toFixed(decimalPrecision);
        const maxDisplay = (maxValue / scalingFactor).toFixed(decimalPrecision);
        console.warn(`⚠️  Price $${rawPrice.toFixed(decimalPrecision)} is outside market range [$${minDisplay}, $${maxDisplay}]`);
        console.warn(`   Proceeding with resolution anyway (price will be clamped by contract)`);
      }
      
      // Step 5: Resolve market
      console.log('🔧 Step 4/4: Resolving market on-chain...');
      await resolveMarket(marketId, scaledPrice);
      
      // Update MongoDB: mark as resolved
      if (this.db) {
        await this.db.collection('scheduled_resolutions').updateOne(
          { marketId: marketId },
          { 
            $set: { 
              status: 'resolved',
              resolvedAt: new Date(),
              resolvedValue: scaledPrice,
              resolvedValueRaw: rawPrice
            } 
          }
        );
      }
      
      console.log('\n✅ Market resolution completed successfully!');
      
    } catch (error: any) {
      console.error(`\n❌ Resolution failed for market ${marketId}:`);
      console.error(`   Error: ${error.message}`);
      
      // Update MongoDB: mark as failed
      if (this.db) {
        await this.db.collection('scheduled_resolutions').updateOne(
          { marketId: marketId },
          { 
            $set: { 
              status: 'failed',
              error: error.message,
              failedAt: new Date()
            } 
          }
        );
      }
      
      // Don't throw - log and continue (can retry on next service restart if needed)
    }
  }
  
  /**
   * Fetch market data from backend API
   */
  private async fetchMarketData(marketId: string): Promise<MarketData> {
    try {
      const response = await axios.get(
        `${CONFIG.apiBaseUrl}/api/markets/${marketId}`,
        { timeout: 10000 }
      );
      
      return response.data;
      
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error(`Market ${marketId} not found in backend`);
      }
      throw new Error(`Failed to fetch market data: ${error.message}`);
    }
  }
  
  /**
   * Cancel a scheduled resolution
   */
  cancelScheduledResolution(marketId: string): boolean {
    const job = this.scheduledJobs.get(marketId);
    if (job) {
      job.cancel();
      this.scheduledJobs.delete(marketId);
      console.log(`❌ Cancelled scheduled resolution for market: ${marketId.slice(0, 10)}...`);
      return true;
    }
    return false;
  }
  
  /**
   * Get count of scheduled jobs
   */
  getScheduledCount(): number {
    return this.scheduledJobs.size;
  }
  
  /**
   * Get all scheduled market IDs
   */
  getScheduledMarkets(): string[] {
    return Array.from(this.scheduledJobs.keys());
  }
}

// Export singleton instance
export const resolutionScheduler = new ResolutionScheduler();
