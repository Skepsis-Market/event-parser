#!/usr/bin/env ts-node

/**
 * Admin Script: Create Market
 * Creates a prediction market on Sui and registers it in the backend API
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import * as dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// Configuration from .env
const PACKAGE_ID = process.env.PACKAGE_ID!;
const MARKET_REGISTRY = process.env.MARKET_REGISTRY!;
const ADMIN_CAP = process.env.ADMIN_CAP!;
const USDC_TYPE = process.env.USDC_TYPE!;
const NETWORK = process.env.SUI_NETWORK || 'testnet';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

interface MarketConfig {
  // Basic info
  marketName: string;
  question: string;
  description: string;
  category: string;
  
  // Range
  minValue: number;
  maxValue: number;
  bucketCount: number;
  
  // Liquidity
  initialLiquidity: number; // In micro-USDC (e.g., 50000000000 = $50K)
  
  // Timing (in hours from now)
  biddingDeadlineHours: number;
  resolutionTimeHours: number;
  
  // Optional
  creatorFeeBasisPoints?: number; // Default: 50 (0.5%)
  decimalPrecision?: number;      // Default: 0
  valueUnit?: string;             // Default: "USD"
  
  // Simple distribution configuration
  useSimpleDistribution?: boolean;   // Default: false
  peakBucket?: number;                // Peak bucket index
  peakPercentage?: number;            // Percentage at peak (basis points)
  edgePercentage?: number;            // Percentage at edges (basis points)
  rangeBuckets?: number;              // Range from peak
  interpolationType?: number;         // 0 = linear
}

async function createMarket(config: MarketConfig) {
  console.log('🚀 Admin: Creating Market');
  console.log('═══════════════════════════');
  
  // Initialize client
  const client = new SuiClient({ 
    url: NETWORK === 'localnet' 
      ? process.env.SUI_RPC_URL! 
      : getFullnodeUrl(NETWORK as any)
  });
  
  // Get keypair
  const privateKeyBase64 = process.env.SUI_PRIVATE_KEY;
  if (!privateKeyBase64) {
    throw new Error('SUI_PRIVATE_KEY not set in .env');
  }
  
  const keypair = Ed25519Keypair.fromSecretKey(privateKeyBase64);
  const signerAddress = keypair.getPublicKey().toSuiAddress();
  
  console.log(`📝 Creator: ${signerAddress.slice(0, 10)}...`);
  console.log(`🌐 Network: ${NETWORK}`);
  console.log(`📊 Market: ${config.question}`);
  
  // Calculate timing
  const biddingDeadline = Date.now() + (config.biddingDeadlineHours * 60 * 60 * 1000);
  const resolutionTime = Date.now() + (config.resolutionTimeHours * 60 * 60 * 1000);
  
  console.log(`⏰ Bidding Deadline: ${new Date(biddingDeadline).toISOString()}`);
  console.log(`⏰ Resolution Time: ${new Date(resolutionTime).toISOString()}`);
  
  // Step 1: Create Creator Capability
  console.log('\n🔧 Step 1/3: Creating Creator Capability...');
  
  const creatorCapTx = new Transaction();
  creatorCapTx.moveCall({
    target: `${PACKAGE_ID}::registry::create_creator_cap_entry`,
    arguments: [
      creatorCapTx.object(ADMIN_CAP),
      creatorCapTx.pure.address(signerAddress),
    ]
  });
  
  const creatorCapResult = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: creatorCapTx,
    options: { showObjectChanges: true },
    requestType: 'WaitForLocalExecution'
  });
  
  const creatorCapObj = creatorCapResult.objectChanges?.find(
    (change: any) => change.type === 'created' && 
    change.objectType?.includes('::registry::CreatorCap')
  );
  
  if (!creatorCapObj) {
    throw new Error('CreatorCap not found');
  }
  
  const creatorCapId = (creatorCapObj as any).objectId;
  console.log(`✅ Creator Cap: ${creatorCapId.slice(0, 10)}...`);
  
  // Step 2: Get USDC coins
  console.log('\n💰 Step 2/3: Preparing USDC liquidity...');
  
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
  console.log(`💵 Required: ${config.initialLiquidity / 1_000_000} USDC`);
  
  if (totalBalance < BigInt(config.initialLiquidity)) {
    throw new Error('Insufficient USDC balance');
  }
  
  // Step 3: Create Market
  console.log('\n📊 Step 3/3: Creating market on-chain...');
  
  const marketTx = new Transaction();
  
  // Merge and split USDC
  let paymentCoin;
  if (usdcCoins.data.length === 1) {
    paymentCoin = marketTx.object(usdcCoins.data[0].coinObjectId);
  } else {
    const [firstCoin, ...restCoins] = usdcCoins.data;
    const baseCoin = marketTx.object(firstCoin.coinObjectId);
    if (restCoins.length > 0) {
      marketTx.mergeCoins(
        baseCoin,
        restCoins.map(coin => marketTx.object(coin.coinObjectId))
      );
    }
    paymentCoin = baseCoin;
  }
  
  const [liquidityCoin] = marketTx.splitCoins(paymentCoin, [
    marketTx.pure.u64(config.initialLiquidity)
  ]);
  
  // Calculate bucket width
  const bucketWidth = Math.floor((config.maxValue - config.minValue) / config.bucketCount);
  
  // Create market
  marketTx.moveCall({
    target: `${PACKAGE_ID}::registry::create_market_entry`,
    arguments: [
      marketTx.object(creatorCapId),
      marketTx.object(MARKET_REGISTRY),
      marketTx.pure.string(config.question),
      marketTx.pure.string(config.description),
      marketTx.pure.string(config.category),
      marketTx.pure.u8(0), // market_type (0=continuous)
      marketTx.pure.u64(config.minValue),
      marketTx.pure.u64(config.maxValue),
      marketTx.pure.u64(config.bucketCount),
      marketTx.pure.u64(bucketWidth),
      marketTx.pure.u64(biddingDeadline),
      marketTx.pure.u64(resolutionTime),
      marketTx.pure.u64(config.creatorFeeBasisPoints || 50),
      marketTx.pure.string("Market resolves to actual value at resolution time"),
      marketTx.pure.address(signerAddress),
      liquidityCoin,
      marketTx.pure.option("u64", null),
      marketTx.pure.u8(config.decimalPrecision || 0),
      marketTx.pure.string(config.valueUnit || "USD"),
      // Simple distribution configuration
      marketTx.pure.bool(config.useSimpleDistribution || false),
      marketTx.pure.u64(config.peakBucket || 0),
      marketTx.pure.u64(config.peakPercentage || 0),
      marketTx.pure.u64(config.edgePercentage || 0),
      marketTx.pure.u64(config.rangeBuckets || 0),
      marketTx.pure.u8(config.interpolationType || 0),
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
  
  // Step 4: Register in backend API
  console.log('\n🌐 Step 4/4: Registering in backend API...');
  
  const apiPayload = {
    marketId: marketId,
    packageId: PACKAGE_ID,
    network: NETWORK,
    createdAt: Date.now().toString(),
    transactionDigest: marketResult.digest,
    creatorCapId: creatorCapId,
    marketType: "prediction",
    configuration: {
      marketName: config.marketName,
      question: config.question,
      description: config.description,
      category: config.category,
      minValue: config.minValue,
      maxValue: config.maxValue,
      bucketCount: config.bucketCount,
      bucketWidth: bucketWidth,
      decimalPrecision: config.decimalPrecision || 0,
      valueUnit: config.valueUnit || "USD",
      biddingDeadline: biddingDeadline,
      resolutionTime: resolutionTime,
      initialLiquidity: config.initialLiquidity,
      usdcType: USDC_TYPE
    }
  };
  
  try {
    const response = await axios.post(
      `${API_BASE_URL}/api/markets`,
      apiPayload,
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    console.log(`✅ API Registration: Success`);
    console.log(`✅ Status: ${response.status}`);
  } catch (error: any) {
    console.log(`⚠️  API Registration Failed: ${error.message}`);
    console.log(`⚠️  Market is created on-chain but not in database`);
    console.log(`\n📋 Manual API payload:`);
    console.log(JSON.stringify(apiPayload, null, 2));
  }
  
  console.log('\n🎉 MARKET CREATION COMPLETE!');
  console.log('═══════════════════════════════');
  console.log(`✅ Market ID: ${marketId}`);
  console.log(`✅ Range: $${config.minValue.toLocaleString()} - $${config.maxValue.toLocaleString()}`);
  console.log(`✅ Liquidity: ${config.initialLiquidity / 1_000_000} USDC`);
  console.log(`✅ Network: ${NETWORK}`);
  
  return { marketId, creatorCapId, transactionDigest: marketResult.digest };
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: tsx src/admin/create-market.ts <config-file.json>');
    console.log('\nExample config.json:');
    console.log(JSON.stringify({
      marketName: "Bitcoin Price Prediction",
      question: "What will Bitcoin price be on Oct 25, 2025?",
      description: "Predict BTC/USD price at resolution",
      category: "Cryptocurrency",
      minValue: 100000,
      maxValue: 120000,
      bucketCount: 200,
      initialLiquidity: 50000000000,
      biddingDeadlineHours: 2,
      resolutionTimeHours: 3
    }, null, 2));
    process.exit(1);
  }
  
  const configPath = args[0];
  const fs = await import('fs');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  
  await createMarket(config);
}

if (require.main === module) {
  main().catch(console.error);
}

export { createMarket };
