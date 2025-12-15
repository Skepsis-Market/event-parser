#!/usr/bin/env ts-node

/**
 * 5-Minute Market Orchestration (Testing)
 * Creates BTC and SUI markets every 5 minutes
 * Bidding deadline: 5 minutes after creation
 * Resolution: 6 minutes after creation
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
  biddingDeadline: Date;
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
 */
function calculateMarketParams(
  crypto: CryptoConfig, 
  currentPrice: number, 
  creationTime: Date
): MarketParams {
  const { bucketCount, bucketWidth } = crypto;
  
  // Determine decimal precision based on bucket width
  const decimalPrecision = bucketWidth < 1 ? 2 : 0;
  
  // Scale prices to integer values (e.g., $1.50 → 150 cents)
  const scaleFactor = decimalPrecision === 2 ? 100 : 1;
  const scaledPrice = currentPrice * scaleFactor;
  const scaledBucketWidth = bucketWidth * scaleFactor;
  
  // Calculate total range needed (in scaled units)
  const totalRange = bucketCount * scaledBucketWidth;
  const halfRange = totalRange / 2;
  
  // Round current price to nearest bucket edge for clean alignment
  const roundedPrice = Math.round(scaledPrice / scaledBucketWidth) * scaledBucketWidth;
  
  // Calculate min/max centered on rounded price (in scaled units)
  let minValue = Math.round(roundedPrice - halfRange);
  let maxValue = Math.round(roundedPrice + halfRange);
  
  // If min is negative, shift the entire range up
  if (minValue < 0) {
    const shift = -minValue;
    minValue = 0;
    maxValue = Math.round(totalRange);
  }
  
  // Bidding deadline: 5 minutes from creation (x+5)
  const biddingDeadline = new Date(creationTime.getTime() + 5 * 60 * 1000);
  
  // Resolution time: 6 minutes from creation (x+6)
  const resolutionTime = new Date(creationTime.getTime() + 6 * 60 * 1000);
  
  return {
    crypto,
    currentPrice,
    minValue,
    maxValue,
    bucketCount,
    bucketWidth,
    creationTime,
    biddingDeadline,
    resolutionTime
  };
}

/**
 * Create 5-minute test market
 */
async function create5MinMarket(params: MarketParams): Promise<string> {
  const { crypto, currentPrice, minValue, maxValue, bucketCount, bucketWidth, creationTime, biddingDeadline, resolutionTime } = params;
  
  console.log(`\n🚀 Creating ${crypto.name} 5-Min Market`);
  console.log('═══════════════════════════════════════════');
  console.log(`📊 Current Price: $${currentPrice.toLocaleString()}`);
  console.log(`📉 Min Value: ${minValue}`);
  console.log(`📈 Max Value: ${maxValue}`);
  console.log(`🪣 Buckets: ${bucketCount} x $${bucketWidth}`);
  console.log(`⏰ Creation: ${creationTime.toISOString()}`);
  console.log(`⏰ Bidding Deadline: ${biddingDeadline.toISOString()}`);
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
  
  const biddingDeadlineMs = biddingDeadline.getTime();
  const resolutionTimeMs = resolutionTime.getTime();
  
  const resolutionTimeStr = resolutionTime.toISOString().replace('T', ' at ').split('.')[0] + ' UTC';
  const resolutionHourMin = resolutionTime.toISOString().split('T')[1].substring(0, 5);
  const dateStr = resolutionTime.toISOString().split('T')[0];
  
  // Determine decimal precision based on bucket width
  const decimalPrecision = bucketWidth < 1 ? 2 : 0;
  
  // Calculate bucket width as integer
  const bucketWidthInt = Math.floor((maxValue - minValue) / bucketCount);
  
  marketTx.moveCall({
    target: `${PACKAGE_ID}::registry::create_market_entry`,
    arguments: [
      marketTx.object(CREATOR_CAP),
      marketTx.object(MARKET_REGISTRY),
      marketTx.pure.string(`What will be the price of ${crypto.name} (${crypto.symbol}/USD) at ${resolutionHourMin} UTC on ${dateStr}?`),
      marketTx.pure.string(`5-min test market. Predict ${crypto.name}'s price at resolution. Current: $${currentPrice.toFixed(decimalPrecision)}`),
      marketTx.pure.string('Cryptocurrency'),
      marketTx.pure.u8(0), // market_type
      marketTx.pure.u64(minValue),
      marketTx.pure.u64(maxValue),
      marketTx.pure.u64(bucketCount),
      marketTx.pure.u64(bucketWidthInt),
      marketTx.pure.u64(biddingDeadlineMs),
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
  
  // Step 3: Register in backend API
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
    resolutionCriteria: `This market resolves using the ${crypto.name} (${crypto.symbol}/USD) price reported by CoinGecko at ${resolutionTimeStr}.\n\nThe final price will be processed to the nearest ${bucketWidth < 1 ? 'cent' : 'dollar'} for settlement.\nOnly the CoinGecko API will be used as the data source.\nMarket range: $${(minValue / (decimalPrecision === 2 ? 100 : 1)).toFixed(decimalPrecision)} - $${(maxValue / (decimalPrecision === 2 ? 100 : 1)).toFixed(decimalPrecision)}`,
    configuration: {
      marketName: `${crypto.name} 5-Min Test - ${dateStr} ${resolutionHourMin}`,
      question: `What will be the price of ${crypto.name} (${crypto.symbol}/USD) at ${resolutionHourMin} UTC on ${dateStr}?`,
      description: `5-min test market. Predict ${crypto.name}'s price at resolution. Current: $${currentPrice.toFixed(decimalPrecision)}`,
      category: 'Cryptocurrency',
      minValue: minValue,
      maxValue: maxValue,
      bucketCount: bucketCount,
      bucketWidth: bucketWidth,
      decimalPrecision: decimalPrecision,
      valueUnit: 'USD',
      biddingDeadline: biddingDeadlineMs,
      resolutionTime: resolutionTimeMs,
      initialLiquidity: initialLiquidity,
      usdcType: USDC_TYPE,
      valueType: 'currency',
      valuePrefix: '$',
      valueSuffix: '',
      useKSuffix: false,
      frequency: 'test',
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
  console.log(`✅ Range: ${minValue} - ${maxValue}`);
  console.log(`✅ Bidding Ends: ${biddingDeadline.toISOString()}`);
  console.log(`✅ Resolves: ${resolutionTime.toISOString()}`);
  
  return marketId;
}

/**
 * Calculate milliseconds until next 5-minute interval
 */
function msUntilNext5Min(): number {
  const now = new Date();
  const nextRun = new Date(now);
  
  // Round up to next 5-minute interval
  const currentMinutes = now.getUTCMinutes();
  const nextInterval = Math.ceil((currentMinutes + 1) / 5) * 5;
  
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
  console.log('🤖 5-Minute Markets Orchestrator Started');
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
  
  async function run5MinCreation() {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  🧪 5-MIN TEST MARKETS - Every 5 Minutes      ║');
    console.log('╚════════════════════════════════════════════════╝\n');
    
    const creationTime = new Date();
    
    try {
      // Create BTC market
      console.log('📈 Creating BTC Market...\n');
      const btcPrice = await fetchCryptoPrice(CRYPTO_CONFIGS.btc.id);
      const btcParams = calculateMarketParams(CRYPTO_CONFIGS.btc, btcPrice, creationTime);
      await create5MinMarket(btcParams);
      
      // Wait 10 seconds between market creations to avoid coin version conflicts
      console.log('\n⏳ Waiting 10 seconds for blockchain to finalize...\n');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Create SUI market
      console.log('📈 Creating SUI Market...\n');
      const suiPrice = await fetchCryptoPrice(CRYPTO_CONFIGS.sui.id);
      const suiParams = calculateMarketParams(CRYPTO_CONFIGS.sui, suiPrice, creationTime);
      await create5MinMarket(suiParams);
      
      console.log('\n✅ Both 5-min markets created successfully!');
      
    } catch (error: any) {
      console.error(`\n❌ 5-min market creation failed: ${error.message}`);
      if (error.stack) {
        console.error(error.stack);
      }
    }
    
    // Schedule next run (next 5-minute interval)
    const msUntilNext = msUntilNext5Min();
    console.log(`\n⏰ Scheduling next run in ${Math.round(msUntilNext / 1000 / 60)} minutes`);
    setTimeout(run5MinCreation, msUntilNext);
  }
  
  // Calculate initial delay
  const initialDelay = msUntilNext5Min();
  console.log(`⏰ First run scheduled in ${Math.round(initialDelay / 1000 / 60)} minutes`);
  console.log(`⏰ Will create markets at: ${new Date(Date.now() + initialDelay).toISOString()}\n`);
  
  setTimeout(run5MinCreation, initialDelay);
}

// Start orchestration
orchestrate().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
