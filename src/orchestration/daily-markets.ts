#!/usr/bin/env ts-node

/**
 * Daily Market Orchestration (11 PM UTC)
 * Creates BTC and SUI markets every day at 11 PM UTC
 * These markets are NOT associated with any series
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import axios from 'axios';
import CONFIG from '../config/env';

const PACKAGE_ID = CONFIG.packageId;
const MARKET_REGISTRY = CONFIG.marketRegistry;
const CREATOR_CAP = CONFIG.creatorCap;
const USDC_TYPE = CONFIG.usdcType;
const NETWORK = CONFIG.suiNetwork;
const API_BASE_URL = CONFIG.apiBaseUrl;
const SUI_RPC_URL = CONFIG.suiRpcUrl;

interface CryptoConfig {
  id: string;
  name: string;
  symbol: string;
  bucketCount: number;
  bucketWidth: number;
  imageUrl: string;
  imageKey: string;
}

const CRYPTO_CONFIGS: Record<string, CryptoConfig> = {
  btc: {
    id: 'bitcoin',
    name: 'Bitcoin',
    symbol: 'BTC',
    bucketCount: 100,
    bucketWidth: 50, // $50 per bucket
    imageUrl: 'https://skepsis-markets-testnet.s3.us-east-1.amazonaws.com/markets/bb2a2168-3ad9-438d-8aac-7a0e2ff8f6ef.png',
    imageKey: 'markets/bb2a2168-3ad9-438d-8aac-7a0e2ff8f6ef.png'
  },
  sui: {
    id: 'sui',
    name: 'Sui',
    symbol: 'SUI',
    bucketCount: 10,
    bucketWidth: 0.05, // $0.05 per bucket (5 cents)
    imageUrl: 'https://skepsis-markets-testnet.s3.us-east-1.amazonaws.com/markets/3f100f05-220e-41ba-aa7b-19bb35eea55a.png',
    imageKey: 'markets/3f100f05-220e-41ba-aa7b-19bb35eea55a.png'
  }
};

interface MarketParams {
  crypto: CryptoConfig;
  currentPrice: number;
  minValue: number;
  maxValue: number;
  bucketCount: number;
  bucketWidth: number;
  creationTime: Date;
  resolutionTime: Date;
}

/**
 * Fetch current crypto price from CoinGecko
 */
async function fetchCryptoPrice(cryptoId: string): Promise<number> {
  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoId}&vs_currencies=usd`,
      { timeout: 10000 }
    );
    
    const price = response.data?.[cryptoId]?.usd;
    if (!price) {
      throw new Error('Price not found in response');
    }
    
    console.log(`📊 Current ${cryptoId.toUpperCase()} Price: $${price.toLocaleString()}`);
    return price;
  } catch (error: any) {
    throw new Error(`Failed to fetch ${cryptoId} price: ${error.message}`);
  }
}

/**
 * Calculate market parameters based on current price
 * The midpoint bucket should contain the current price
 */
function calculateMarketParams(
  crypto: CryptoConfig, 
  currentPrice: number, 
  creationTime: Date
): MarketParams {
  const { bucketCount, bucketWidth } = crypto;
  
  // Calculate total range needed
  const totalRange = bucketCount * bucketWidth;
  const halfRange = totalRange / 2;
  
  // Round current price to nearest bucket edge for clean alignment
  const roundedPrice = Math.round(currentPrice / bucketWidth) * bucketWidth;
  
  // Calculate min/max centered on rounded price
  let minValue = roundedPrice - halfRange;
  let maxValue = roundedPrice + halfRange;
  
  // If min is negative, shift the entire range up
  if (minValue < 0) {
    const shift = -minValue;
    minValue = 0;
    maxValue = totalRange;
  }
  
  // Resolution time is 10 minutes from creation (testing)
  const resolutionTime = new Date(creationTime.getTime() + 10 * 60 * 1000);
  
  return {
    crypto,
    currentPrice,
    minValue,
    maxValue,
    bucketCount,
    bucketWidth,
    creationTime,
    resolutionTime
  };
}

/**
 * Create daily crypto market
 */
async function createDailyMarket(params: MarketParams): Promise<string> {
  const { crypto, currentPrice, minValue, maxValue, bucketCount, bucketWidth, creationTime, resolutionTime } = params;
  
  console.log(`\n🚀 Creating ${crypto.name} Daily Market`);
  console.log('═══════════════════════════════════════════');
  console.log(`📊 Current Price: $${currentPrice.toLocaleString()}`);
  console.log(`📉 Min Value: $${minValue.toLocaleString()}`);
  console.log(`📈 Max Value: $${maxValue.toLocaleString()}`);
  console.log(`🪣 Buckets: ${bucketCount} x $${bucketWidth}`);
  console.log(`⏰ Creation: ${creationTime.toISOString()}`);
  console.log(`⏰ Resolution: ${resolutionTime.toISOString()}`);
  
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
  console.log('\n💰 Step 1/3: Preparing USDC liquidity...');
  const initialLiquidity = 5_000_000_000; // 5,000 USDC
  
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
  console.log('\n📊 Step 2/3: Creating market on-chain...');
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
  
  // Both bidding and resolution at 11 PM UTC next day
  const biddingDeadline = resolutionTime.getTime();
  const resolutionTimeMs = resolutionTime.getTime();
  
  const dateStr = creationTime.toISOString().split('T')[0];
  const tomorrowDateStr = resolutionTime.toISOString().split('T')[0];
  
  // Determine decimal precision based on bucket width
  const decimalPrecision = bucketWidth < 1 ? 2 : 0;
  
  // Scale values based on decimal precision (convert dollars to cents for 2 decimals)
  const scaleFactor = decimalPrecision === 2 ? 100 : 1;
  const scaledMinValue = Math.round(minValue * scaleFactor);
  const scaledMaxValue = Math.round(maxValue * scaleFactor);
  const scaledBucketWidth = Math.round(bucketWidth * scaleFactor);
  
  marketTx.moveCall({
    target: `${PACKAGE_ID}::registry::create_market_entry`,
    arguments: [
      marketTx.object(CREATOR_CAP),
      marketTx.object(MARKET_REGISTRY),
      marketTx.pure.string(`What will be the price of ${crypto.name} (${crypto.symbol}/USD) at 11 PM UTC on ${tomorrowDateStr}?`),
      marketTx.pure.string(`Predict ${crypto.name}'s price tomorrow at 11 PM UTC. Current price: $${currentPrice.toFixed(decimalPrecision)}`),
      marketTx.pure.string('Cryptocurrency'),
      marketTx.pure.u8(0), // market_type
      marketTx.pure.u64(scaledMinValue),
      marketTx.pure.u64(scaledMaxValue),
      marketTx.pure.u64(bucketCount),
      marketTx.pure.u64(scaledBucketWidth),
      marketTx.pure.u64(biddingDeadline),
      marketTx.pure.u64(resolutionTimeMs),
      marketTx.pure.u64(50), // creatorFeeBasisPoints
      marketTx.pure.string(`Market resolves using CoinGecko ${crypto.symbol}/USD price at resolution time`),
      marketTx.pure.address(signerAddress),
      liquidityCoin,
      marketTx.pure.option('u64', null), // custom_alpha
      marketTx.pure.u8(decimalPrecision),
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
  
  // Step 3: Register in backend API (NO series fields)
  console.log('\n🌐 Step 3/3: Registering in backend API...');
  
  const apiPayload = {
    marketId: marketId,
    creatorCapId: CREATOR_CAP,
    packageId: PACKAGE_ID,
    network: NETWORK,
    createdAt: creationTime.getTime().toString(),
    transactionDigest: marketResult.digest,
    marketType: 'cryptocurrency',
    priceFeed: `https://api.coingecko.com/api/v3/simple/price?ids=${crypto.id}&vs_currencies=usd&include_24hr_change=true`,
    // NO seriesId, roundNumber, or isSeriesMaster
    resolutionCriteria: `This market resolves using the ${crypto.name} (${crypto.symbol}/USD) price reported by CoinGecko at ${resolutionTime.toISOString()}.\n\nThe final price will be processed to the nearest ${bucketWidth < 1 ? 'cent' : 'dollar'} for settlement.\nOnly the CoinGecko API will be used as the data source.\nMarket range: $${minValue.toFixed(decimalPrecision)} - $${maxValue.toFixed(decimalPrecision)}`,
    configuration: {
      marketName: `${crypto.name} Daily - ${dateStr}`,
      question: `What will be the price of ${crypto.name} (${crypto.symbol}/USD) at 11 PM UTC on ${tomorrowDateStr}?`,
      description: `Predict ${crypto.name}'s price tomorrow at 11 PM UTC. Current price: $${currentPrice.toFixed(decimalPrecision)}`,
      category: 'Cryptocurrency',
      minValue: minValue,
      maxValue: maxValue,
      bucketCount: bucketCount,
      bucketWidth: bucketWidth,
      decimalPrecision: decimalPrecision,
      valueUnit: 'USD',
      biddingDeadline: biddingDeadline,
      resolutionTime: resolutionTimeMs,
      initialLiquidity: initialLiquidity,
      usdcType: USDC_TYPE,
      valueType: 'currency',
      valuePrefix: '$',
      valueSuffix: '',
      useKSuffix: false,
      frequency: 'daily',
      marketImage: crypto.imageUrl,
      marketImageKey: crypto.imageKey
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
  } catch (error: any) {
    console.log(`⚠️  API Registration Failed: ${error.message}`);
    if (error.response?.data) {
      console.log(`⚠️  Error Details:`, JSON.stringify(error.response.data, null, 2));
    }
  }
  
  console.log('\n🎉 MARKET CREATED!');
  console.log('═══════════════════');
  console.log(`✅ Market ID: ${marketId}`);
  console.log(`✅ Range: $${minValue.toFixed(decimalPrecision)} - $${maxValue.toFixed(decimalPrecision)}`);
  console.log(`✅ Resolves: ${resolutionTime.toISOString()}`);
  
  return marketId;
}

/**
 * Calculate milliseconds until next 10-minute interval (testing)
 */
function msUntil11PMUTC(): number {
  const now = new Date();
  const nextRun = new Date(now);
  
  // Round up to next 10-minute interval
  const currentMinutes = now.getUTCMinutes();
  const nextInterval = Math.ceil((currentMinutes + 1) / 10) * 10;
  
  if (nextInterval >= 60) {
    nextRun.setUTCHours(nextRun.getUTCHours() + 1);
    nextRun.setUTCMinutes(0, 0, 0);
  } else {
    nextRun.setUTCMinutes(nextInterval, 0, 0);
  }
  
  const msUntil = nextRun.getTime() - now.getTime();
  
  console.log(`⏰ Next run: ${nextRun.toISOString()} (in ${Math.round(msUntil / 1000 / 60)} minutes)`);
  
  return msUntil;
}

/**
 * Main orchestration loop
 */
async function orchestrate() {
  console.log('🤖 Daily Markets Orchestrator Started');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`🌐 Network: ${NETWORK}`);
  console.log(`📦 Package: ${PACKAGE_ID.slice(0, 10)}...`);
  console.log(`🏢 Registry: ${MARKET_REGISTRY.slice(0, 10)}...`);
  console.log('═══════════════════════════════════════════════════\n');
  
  // Validate prerequisites
  if (!CREATOR_CAP) {
    console.error('❌ CREATOR_CAP not set. Run: npm run admin:create-creator-cap');
    process.exit(1);
  }
  
  async function runDailyCreation() {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  🧪 TEST MARKET CREATION - 18:25 UTC          ║');
    console.log('╚════════════════════════════════════════════════╝\n');
    
    const creationTime = new Date();
    
    try {
      // Create BTC market
      console.log('📈 Creating BTC Market...\n');
      const btcPrice = await fetchCryptoPrice(CRYPTO_CONFIGS.btc.id);
      const btcParams = calculateMarketParams(CRYPTO_CONFIGS.btc, btcPrice, creationTime);
      await createDailyMarket(btcParams);
      
      // Wait 5 seconds between market creations
      console.log('\n⏳ Waiting 5 seconds...\n');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Create SUI market
      console.log('📈 Creating SUI Market...\n');
      const suiPrice = await fetchCryptoPrice(CRYPTO_CONFIGS.sui.id);
      const suiParams = calculateMarketParams(CRYPTO_CONFIGS.sui, suiPrice, creationTime);
      await createDailyMarket(suiParams);
      
      console.log('\n✅ Both daily markets created successfully!');
      
    } catch (error: any) {
      console.error(`\n❌ Daily market creation failed: ${error.message}`);
      if (error.stack) {
        console.error(error.stack);
      }
    }
    
    // Schedule next run
    const msUntilNext = msUntil11PMUTC();
    console.log(`\n⏰ Scheduling next run in ${Math.round(msUntilNext / 1000 / 60 / 60)} hours`);
    setTimeout(runDailyCreation, msUntilNext);
  }
  
  // Calculate initial delay
  const initialDelay = msUntil11PMUTC();
  console.log(`⏰ First run scheduled in ${Math.round(initialDelay / 1000 / 60)} minutes`);
  console.log(`⏰ Will create markets at: ${new Date(Date.now() + initialDelay).toISOString()}\n`);
  
  setTimeout(runDailyCreation, initialDelay);
}

// Start orchestration
orchestrate().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
