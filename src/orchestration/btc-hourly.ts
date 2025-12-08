#!/usr/bin/env ts-node

/**
 * BTC Hourly Market Orchestration
 * Creates a new BTC market every hour with dynamic pricing
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import axios from 'axios';
import CONFIG from '../config/env';

const PACKAGE_ID = CONFIG.packageId;
const MARKET_REGISTRY = CONFIG.marketRegistry;
const CREATOR_CAP = CONFIG.creatorCap;
const SERIES_ID = CONFIG.seriesId;
const USDC_TYPE = CONFIG.usdcType;
const NETWORK = CONFIG.suiNetwork;
const API_BASE_URL = CONFIG.apiBaseUrl;
const SUI_RPC_URL = CONFIG.suiRpcUrl;

// Series tracking
let currentRoundNumber = 0;

// Fixed parameters
const BUCKET_COUNT = 10;
const BUCKET_WIDTH = 20; // $20 per bucket
const TOTAL_RANGE = BUCKET_COUNT * BUCKET_WIDTH; // $200 total range
const HALF_RANGE = TOTAL_RANGE / 2; // $100 on each side

interface MarketParams {
  currentPrice: number;
  minValue: number;
  maxValue: number;
  bucketCount: number;
  bucketWidth: number;
  creationTime: Date;
  resolutionTime: Date;
}

/**
 * Fetch current BTC price from CoinGecko
 */
async function fetchBTCPrice(): Promise<number> {
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      { timeout: 10000 }
    );
    
    const price = response.data?.bitcoin?.usd;
    if (!price) {
      throw new Error('Price not found in response');
    }
    
    console.log(`📊 Current BTC Price: $${price.toLocaleString()}`);
    return price;
  } catch (error: any) {
    throw new Error(`Failed to fetch BTC price: ${error.message}`);
  }
}

/**
 * Fetch current round number from series API
 */
async function fetchCurrentRoundNumber(): Promise<number> {
  if (!SERIES_ID) {
    console.log('⚠️  No SERIES_ID configured, starting at round 0');
    return 0;
  }
  
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/series/${SERIES_ID}`,
      {
        headers: { 'x-admin-secret': CONFIG.adminSecret },
        timeout: 10000
      }
    );
    
    const roundNum = response.data?.currentRoundNumber || 0;
    console.log(`📊 Current Round Number: ${roundNum}`);
    return roundNum;
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log('⚠️  Series not found, starting at round 0');
      return 0;
    }
    throw new Error(`Failed to fetch round number: ${error.message}`);
  }
}

/**
 * Calculate market parameters based on current price
 */
function calculateMarketParams(currentPrice: number, creationTime: Date): MarketParams {
  // Round current price to nearest $20 for cleaner midpoint
  const roundedMidpoint = Math.round(currentPrice / BUCKET_WIDTH) * BUCKET_WIDTH;
  
  // Calculate min/max (±$200 from midpoint)
  const rawMin = roundedMidpoint - HALF_RANGE;
  const rawMax = roundedMidpoint + HALF_RANGE;
  
  // Round to nearest $20 (should already be aligned, but just in case)
  const minValue = Math.round(rawMin / BUCKET_WIDTH) * BUCKET_WIDTH;
  const maxValue = Math.round(rawMax / BUCKET_WIDTH) * BUCKET_WIDTH;
  
  // Resolution time is exactly 1 hour after creation
  const resolutionTime = new Date(creationTime.getTime() + 60 * 60 * 1000);
  
  return {
    currentPrice,
    minValue,
    maxValue,
    bucketCount: BUCKET_COUNT,
    bucketWidth: BUCKET_WIDTH,
    creationTime,
    resolutionTime
  };
}

/**
 * Create hourly BTC market
 */
async function createHourlyMarket(params: MarketParams): Promise<string> {
  console.log('\n🚀 Creating BTC Hourly Market');
  console.log('═══════════════════════════════');
  
  // Increment round number
  currentRoundNumber++;
  console.log(`🔢 Round Number: ${currentRoundNumber}`);
  console.log(`📊 Current Price: $${params.currentPrice.toLocaleString()}`);
  console.log(`📉 Min Value: $${params.minValue.toLocaleString()}`);
  console.log(`📈 Max Value: $${params.maxValue.toLocaleString()}`);
  console.log(`🪣 Buckets: ${params.bucketCount} (${params.bucketWidth} each)`);
  console.log(`⏰ Creation: ${params.creationTime.toISOString()}`);
  console.log(`⏰ Resolution: ${params.resolutionTime.toISOString()}`);
  
  // Initialize client
  const client = new SuiClient({ 
    url: NETWORK === 'localnet' ? SUI_RPC_URL : getFullnodeUrl(NETWORK as any)
  });
  
  // Get keypair
  const privateKeyBase64 = CONFIG.suiPrivateKey;
  if (!privateKeyBase64) {
    throw new Error('SUI_PRIVATE_KEY not set');
  }
  
  const keypair = Ed25519Keypair.fromSecretKey(privateKeyBase64);
  const signerAddress = keypair.getPublicKey().toSuiAddress();
  
  console.log(`\n🔑 Using Creator Cap: ${CREATOR_CAP.slice(0, 10)}...`);
  
  // Step 1: Prepare USDC liquidity
  console.log('\n💰 Step 1/2: Preparing USDC liquidity...');
  const initialLiquidity = 1_000_000_000; // 1,000 USDC
  
  const usdcCoins = await client.getCoins({
    owner: signerAddress,
    coinType: USDC_TYPE,
  });
  
  if (!usdcCoins.data || usdcCoins.data.length === 0) {
    throw new Error('No USDC coins found in wallet');
  }
  
  const totalBalance = usdcCoins.data.reduce(
    (sum, coin) => sum + BigInt(coin.balance), 
    0n
  );
  
  console.log(`💵 Available: ${Number(totalBalance) / 1_000_000} USDC`);
  console.log(`💵 Required: ${initialLiquidity / 1_000_000} USDC`);
  
  if (totalBalance < BigInt(initialLiquidity)) {
    throw new Error('Insufficient USDC balance');
  }
  
  // Step 2: Create market
  console.log('\n📊 Step 2/2: Creating market on-chain...');
  const marketTx = new Transaction();
  
  // Merge and split USDC
  const coinIds = usdcCoins.data.map(c => c.coinObjectId);
  if (coinIds.length > 1) {
    marketTx.mergeCoins(marketTx.object(coinIds[0]), coinIds.slice(1).map(id => marketTx.object(id)));
  }
  
  const [liquidityCoin] = marketTx.splitCoins(
    marketTx.object(coinIds[0]),
    [marketTx.pure.u64(initialLiquidity)]
  );
  
  const biddingDeadline = params.resolutionTime.getTime() - 60_000; // 1 minute before resolution
  const resolutionTime = params.resolutionTime.getTime();
  
  const hourStr = params.creationTime.getUTCHours().toString().padStart(2, '0');
  const dateStr = params.creationTime.toISOString().split('T')[0];
  
  marketTx.moveCall({
    target: `${PACKAGE_ID}::registry::create_market_entry`,
    arguments: [
      marketTx.object(CREATOR_CAP),
      marketTx.object(MARKET_REGISTRY),
      marketTx.pure.string(`What will be the price of Bitcoin (BTC/USD) at ${hourStr}:00 UTC?`),
      marketTx.pure.string(`Predict Bitcoin's price at the top of the hour. Current price: ~$${Math.round(params.currentPrice / 1000)}k`),
      marketTx.pure.string('Cryptocurrency'),
      marketTx.pure.u8(0), // market_type
      marketTx.pure.u64(params.minValue),
      marketTx.pure.u64(params.maxValue),
      marketTx.pure.u64(params.bucketCount),
      marketTx.pure.u64(params.bucketWidth),
      marketTx.pure.u64(biddingDeadline),
      marketTx.pure.u64(resolutionTime),
      marketTx.pure.u64(50), // creatorFeeBasisPoints
      marketTx.pure.string('Market resolves using CoinGecko BTC/USD price at resolution time'),
      marketTx.pure.address(signerAddress),
      liquidityCoin,
      marketTx.pure.option('u64', null), // custom_alpha
      marketTx.pure.u8(0), // decimalPrecision
      marketTx.pure.string('USD'),
    ],
    typeArguments: [USDC_TYPE]
  });
  
  const marketResult = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: marketTx,
    options: { showObjectChanges: true },
    requestType: 'WaitForLocalExecution'
  });
  
  const marketObj = marketResult.objectChanges?.find(
    (change: any) => change.type === 'created' && 
    change.objectType?.includes('::market::Market<') &&
    'owner' in change && 'Shared' in (change.owner || {})
  );
  
  if (!marketObj) {
    throw new Error('Market object not found');
  }
  
  const marketId = (marketObj as any).objectId;
  console.log(`✅ Market Created: ${marketId}`);
  console.log(`✅ Transaction: ${marketResult.digest}`);
  
  // Step 3: Register in backend API
  console.log('\n🌐 Step 3/3: Registering in backend API...');
  
  const apiPayload = {
    marketId: marketId,
    creatorCapId: CREATOR_CAP,
    packageId: PACKAGE_ID,
    network: NETWORK,
    createdAt: params.creationTime.getTime().toString(),
    transactionDigest: marketResult.digest,
    marketType: 'cryptocurrency',
    priceFeed: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true',
    // Series fields
    ...(SERIES_ID && {
      seriesId: SERIES_ID,
      roundNumber: currentRoundNumber,
      isSeriesMaster: true
    }),
    resolutionCriteria: `This market resolves using the Bitcoin (BTC/USD) price reported by CoinGecko at ${params.resolutionTime.toISOString()}.\n\nThe final price will be floored to the nearest dollar for settlement.\nOnly the CoinGecko API will be used as the data source.\nMarket range: $${params.minValue.toLocaleString()} - $${params.maxValue.toLocaleString()}`,
    configuration: {
      marketName: `Bitcoin Hourly - ${dateStr} ${hourStr}:00 UTC`,
      question: `What will be the price of Bitcoin (BTC/USD) at ${hourStr}:00 UTC?`,
      description: `Predict Bitcoin's price at the top of the hour. Current price: ~$${Math.round(params.currentPrice / 1000)}k`,
      category: 'Cryptocurrency',
      minValue: params.minValue,
      maxValue: params.maxValue,
      bucketCount: params.bucketCount,
      bucketWidth: params.bucketWidth,
      decimalPrecision: 0,
      valueUnit: 'USD',
      biddingDeadline: biddingDeadline,
      resolutionTime: resolutionTime,
      initialLiquidity: initialLiquidity,
      usdcType: USDC_TYPE,
      valueType: 'currency',
      valuePrefix: '$',
      valueSuffix: '',
      useKSuffix: false,  // Show full price for precision (e.g., $89,420 not $89.4K)
      frequency: 'hourly',
      marketImage: 'https://skepsis-markets-testnet.s3.us-east-1.amazonaws.com/markets/bb2a2168-3ad9-438d-8aac-7a0e2ff8f6ef.png',
      marketImageKey: 'markets/bb2a2168-3ad9-438d-8aac-7a0e2ff8f6ef.png'
    }
  };
  
  try {
    await axios.post(
      `${API_BASE_URL}/api/markets`,
      apiPayload,
      { 
        headers: { 
          'Content-Type': 'application/json',
          'x-admin-secret': CONFIG.adminSecret
        } 
      }
    );
    console.log(`✅ API Registration: Success`);
    
    // Update series active market if series exists
    if (SERIES_ID) {
      console.log('🔄 Updating series active market...');
      const nextSpawnTime = params.resolutionTime.getTime() + 60_000; // 1 minute after resolution
      
      await axios.patch(
        `${API_BASE_URL}/api/series/${SERIES_ID}/active-market`,
        {
          activeMarketId: marketId,
          currentRoundNumber: currentRoundNumber,
          nextSpawnTime: nextSpawnTime
        },
        { 
          headers: { 
            'Content-Type': 'application/json',
            'x-admin-secret': CONFIG.adminSecret
          } 
        }
      );
      console.log(`✅ Series Update: Success`);
    }
  } catch (error: any) {
    console.log(`⚠️  API Registration Failed: ${error.message}`);
    if (error.response?.data) {
      console.log(`⚠️  Error Details:`, error.response.data);
    }
  }
  
  console.log('\n🎉 MARKET CREATED!');
  console.log('═══════════════════');
  console.log(`✅ Market ID: ${marketId}`);
  console.log(`✅ Range: $${params.minValue.toLocaleString()} - $${params.maxValue.toLocaleString()}`);
  console.log(`✅ Resolves: ${params.resolutionTime.toISOString()}`);
  
  return marketId;
}

/**
 * Calculate milliseconds until next 5-minute interval (for testing)
 */
function msUntilNextHour(): number {
  const now = new Date();
  const next5Min = new Date(now);
  const currentMinute = now.getMinutes();
  const nextInterval = Math.ceil((currentMinute + 1) / 5) * 5;
  next5Min.setMinutes(nextInterval, 0, 0);
  if (nextInterval >= 60) {
    next5Min.setHours(now.getHours() + 1);
  }
  return next5Min.getTime() - now.getTime();
}

/**
 * Main orchestration loop
 */
async function orchestrate() {
  console.log('🤖 BTC Hourly Market Orchestrator (TEST MODE: 5min intervals)');
  console.log('═══════════════════════════════════');
  console.log(`🌐 Network: ${NETWORK}`);
  console.log(`📊 Bucket Count: ${BUCKET_COUNT}`);
  console.log(`📏 Bucket Width: $${BUCKET_WIDTH}`);
  console.log(`📐 Total Range: ±$${HALF_RANGE} ($${TOTAL_RANGE} total)`);
  
  // Validate Creator Cap
  if (!CREATOR_CAP) {
    console.error('\n❌ Error: CREATOR_CAP not set in .env');
    console.error('Run: npm run admin:create-creator-cap');
    process.exit(1);
  }
  console.log(`🔑 Creator Cap: ${CREATOR_CAP.slice(0, 10)}...`);
  
  // Initialize series tracking
  if (SERIES_ID) {
    console.log(`🔗 Series ID: ${SERIES_ID}`);
    console.log('\n📡 Fetching current round number...');
    try {
      currentRoundNumber = await fetchCurrentRoundNumber();
      console.log(`✅ Starting from round ${currentRoundNumber}`);
    } catch (error: any) {
      console.error(`\n❌ Failed to fetch round number: ${error.message}`);
      console.error('Please ensure the series exists or remove SERIES_ID from .env');
      process.exit(1);
    }
  } else {
    console.log('⚠️  No SERIES_ID configured - markets will not be linked to a series');
    console.log('To enable series tracking: POST /api/series and add ID to .env');
  }
  
  console.log('\n⏳ Waiting for next 5-minute interval...\n');
  
  // Wait until next 5-minute interval if not already there
  const msToWait = msUntilNextHour();
  if (msToWait > 1000) {
    const endTime = Date.now() + msToWait;
    
    const initialCountdown = setInterval(() => {
      const remaining = endTime - Date.now();
      const now = new Date().toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
      if (remaining <= 0) {
        clearInterval(initialCountdown);
        process.stdout.write('\r⏰ Starting first market creation!                              \n');
      } else {
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        process.stdout.write(`\r🕐 ${now} | ⏱️  First market in: ${minutes}m ${seconds}s...`);
      }
    }, 1000);
    
    await new Promise(resolve => setTimeout(resolve, msToWait));
    clearInterval(initialCountdown);
  }
  
  while (true) {
    try {
      const creationTime = new Date();
      // Round to current 5-minute interval for testing
      const currentMinute = creationTime.getMinutes();
      const intervalMinute = Math.floor(currentMinute / 5) * 5;
      creationTime.setMinutes(intervalMinute, 0, 0);
      
      console.log(`\n⏰ ${creationTime.toISOString()} - Starting market creation...`);
      
      // Fetch current price
      const currentPrice = await fetchBTCPrice();
      
      // Calculate parameters (resolution in 5 minutes for testing)
      const testResolutionTime = new Date(creationTime.getTime() + 5 * 60 * 1000);
      const params = {
        ...calculateMarketParams(currentPrice, creationTime),
        resolutionTime: testResolutionTime
      };
      
      console.log(`📅 Bidding closes: ${new Date(testResolutionTime.getTime() - 60_000).toISOString()}`);
      console.log(`📅 Resolution: ${testResolutionTime.toISOString()}`);
      
      // Create market
      await createHourlyMarket(params);
      
      // Wait until next 5-minute interval with live countdown
      console.log(`\n⏳ Waiting for next 5-minute interval...`);
      const waitTime = 5 * 60 * 1000;
      const endTime = Date.now() + waitTime;
      
      const countdown = setInterval(() => {
        const remaining = endTime - Date.now();
        const now = new Date().toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
        if (remaining <= 0) {
          clearInterval(countdown);
          process.stdout.write('\r⏰ Time to create next market!                              \n');
        } else {
          const minutes = Math.floor(remaining / 60000);
          const seconds = Math.floor((remaining % 60000) / 1000);
          process.stdout.write(`\r🕐 ${now} | ⏱️  Next market in: ${minutes}m ${seconds}s...`);
        }
      }, 1000);
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
      clearInterval(countdown);
      
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
      console.log('⏳ Retrying in 5 minutes...\n');
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
    }
  }
}

// Start orchestration
orchestrate().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
