#!/usr/bin/env ts-node

/**
 * Admin Script: Resolve Market
 * Resolves a prediction market on Sui and updates status in backend API
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import axios from 'axios';
import CONFIG from '../config/env';

// Use dynamic config based on ENVIRONMENT flag
const PACKAGE_ID = CONFIG.packageId;
const USDC_TYPE = CONFIG.usdcType;
const NETWORK = CONFIG.suiNetwork;
const API_BASE_URL = CONFIG.apiBaseUrl;
const SUI_RPC_URL = CONFIG.suiRpcUrl;

interface ResolveConfig {
  marketId: string;
  resolutionValue: number;
}

async function resolveMarket(config: ResolveConfig) {
  console.log('🏁 Admin: Resolving Market');
  console.log('══════════════════════════');
  
  // Initialize client
  const client = new SuiClient({ 
    url: NETWORK === 'localnet' 
      ? SUI_RPC_URL
      : getFullnodeUrl(NETWORK as any)
  });
  
  // Get keypair
  const privateKeyBase64 = CONFIG.suiPrivateKey;
  if (!privateKeyBase64) {
    throw new Error('SUI_PRIVATE_KEY not set in .env');
  }
  
  const keypair = Ed25519Keypair.fromSecretKey(privateKeyBase64);
  const signerAddress = keypair.getPublicKey().toSuiAddress();
  
  console.log(`📝 Resolver: ${signerAddress.slice(0, 10)}...`);
  console.log(`🌐 Network: ${NETWORK}`);
  console.log(`🎯 Market: ${config.marketId.slice(0, 10)}...`);
  console.log(`💰 Resolution Value: ${config.resolutionValue.toLocaleString()}`);
  
  // Step 1: Verify market state
  console.log('\n📊 Step 1/3: Checking market state...');
  
  const marketObj = await client.getObject({
    id: config.marketId,
    options: { showContent: true, showType: true }
  });
  
  if (!marketObj.data) {
    throw new Error(`Market not found: ${config.marketId}`);
  }
  
  if (!marketObj.data.content) {
    console.log('Market object:', JSON.stringify(marketObj.data, null, 2));
    throw new Error('Market object has no content - may need time to index');
  }
  
  if (!('fields' in marketObj.data.content)) {
    console.log('Market content:', JSON.stringify(marketObj.data.content, null, 2));
    throw new Error('Invalid market object structure - fields not found');
  }
  
  const fields = marketObj.data.content.fields as any;
  
  if (fields.state !== 0) {
    throw new Error(`Market is already resolved! State: ${fields.state}`);
  }
  
  console.log(`✅ Market is open and ready for resolution`);
  console.log(`   Range: $${Number(fields.min_value).toLocaleString()} - $${Number(fields.max_value).toLocaleString()}`);
  
  // Step 2: Resolve on-chain
  console.log('\n⛓️  Step 2/3: Resolving on-chain...');
  
  const tx = new Transaction();
  
  tx.moveCall({
    target: `${PACKAGE_ID}::settlement::resolve_market_with_outcome`,
    arguments: [
      tx.object(config.marketId),
      tx.pure.address(signerAddress),
      tx.pure.u64(config.resolutionValue)
    ],
    typeArguments: [USDC_TYPE]
  });
  
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
    requestType: 'WaitForLocalExecution'
  });
  
  console.log(`✅ Transaction: ${result.digest}`);
  
  // Check for resolution event
  const resolutionEvent = result.events?.find(
    (event: any) => event.type?.includes('::market::MarketResolved')
  );
  
  if (resolutionEvent) {
    console.log(`✅ Resolution Event Detected`);
  }
  
  // Step 3: Update backend API
  console.log('\n🌐 Step 3/3: Updating backend API...');
  
  try {
    const response = await axios.patch(
      `${API_BASE_URL}/api/markets/${config.marketId}/status`,
      { 
        status: 'resolved',
        resolvedValue: config.resolutionValue
      },
      { 
        headers: { 
          'Content-Type': 'application/json',
          'x-admin-secret': CONFIG.adminSecret
        } 
      }
    );
    
    console.log(`✅ API Update: Success`);
    console.log(`✅ Status: ${response.status}`);
  } catch (error: any) {
    console.log(`⚠️  API Update Failed: ${error.message}`);
    if (error.response) {
      console.log(`⚠️  Status Code: ${error.response.status}`);
      console.log(`⚠️  Response Data:`, JSON.stringify(error.response.data, null, 2));
    }
    console.log(`⚠️  Market is resolved on-chain but status not updated in database`);
    console.log(`\n📋 Manual API call:`);
    console.log(`PATCH ${API_BASE_URL}/api/markets/${config.marketId}/status`);
    console.log(`Body: {"status": "resolved", "resolvedValue": ${config.resolutionValue}}`);
  }
  
  console.log('\n🎉 MARKET RESOLUTION COMPLETE!');
  console.log('══════════════════════════════');
  console.log(`✅ Market ID: ${config.marketId}`);
  console.log(`✅ Resolution Value: ${config.resolutionValue.toLocaleString()}`);
  console.log(`✅ Transaction: ${result.digest}`);
  console.log(`✅ Network: ${NETWORK}`);
  
  return { marketId: config.marketId, transactionDigest: result.digest };
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: tsx src/admin/resolve-market.ts <marketId> <resolutionValue>');
    console.log('\nExample:');
    console.log('  tsx src/admin/resolve-market.ts 0x123abc... 109750');
    process.exit(1);
  }
  
  const config: ResolveConfig = {
    marketId: args[0],
    resolutionValue: parseInt(args[1])
  };
  
  await resolveMarket(config);
}

if (require.main === module) {
  main().catch(console.error);
}

export { resolveMarket };
