/**
 * Market Resolver Module
 * Resolves markets on-chain and updates backend API
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import axios from 'axios';
import CONFIG from '../config/env';

const PACKAGE_ID = CONFIG.packageId;
const USDC_TYPE = CONFIG.usdcType;
const NETWORK = CONFIG.suiNetwork;
const SUI_RPC_URL = CONFIG.suiRpcUrl;
const API_BASE_URL = CONFIG.apiBaseUrl;

/**
 * Resolve a market on-chain using the resolve_market function
 */
export async function resolveMarketOnChain(
  marketId: string,
  resolvedValue: number
): Promise<string> {
  try {
    // Initialize client
    const client = new SuiClient({ 
      url: NETWORK === 'localnet' 
        ? SUI_RPC_URL
        : getFullnodeUrl(NETWORK as any)
    });
    
    // Get keypair
    const privateKeyBase64 = CONFIG.suiPrivateKey;
    if (!privateKeyBase64) {
      throw new Error('SUI_PRIVATE_KEY not set');
    }
    
    const keypair = Ed25519Keypair.fromSecretKey(privateKeyBase64);
    
    console.log(`🔧 Resolving market on-chain: ${marketId.slice(0, 10)}...`);
    console.log(`📊 Resolution value: ${resolvedValue}`);
    
    // Create transaction
    const tx = new Transaction();
    
    tx.moveCall({
      target: `${PACKAGE_ID}::market::resolve_market`,
      arguments: [
        tx.object(marketId),
        tx.pure.u64(resolvedValue),
      ],
      typeArguments: [USDC_TYPE]
    });
    
    // Execute transaction
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true },
      requestType: 'WaitForLocalExecution'
    });
    
    console.log(`✅ On-chain resolution complete: ${result.digest}`);
    
    return result.digest;
    
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      throw new Error(`Market ${marketId} not found on-chain`);
    } else if (error.message?.includes('already resolved')) {
      throw new Error(`Market ${marketId} already resolved`);
    } else {
      throw new Error(`On-chain resolution failed: ${error.message}`);
    }
  }
}

/**
 * Update backend API with resolution status
 */
export async function updateBackendAPI(
  marketId: string,
  resolvedValue: number
): Promise<void> {
  try {
    console.log(`🌐 Updating backend API for market: ${marketId.slice(0, 10)}...`);
    
    const response = await axios.patch(
      `${API_BASE_URL}/api/markets/${marketId}/status`,
      { 
        status: 'resolved',
        resolvedValue: resolvedValue
      },
      { 
        headers: { 
          'Content-Type': 'application/json',
          'x-admin-secret': CONFIG.adminSecret
        },
        timeout: 10000
      }
    );
    
    console.log(`✅ Backend API updated (status: ${response.status})`);
    
  } catch (error: any) {
    if (error.response) {
      throw new Error(`API update failed (${error.response.status}): ${error.response.data?.message || error.message}`);
    } else if (error.request) {
      throw new Error('Backend API unreachable');
    } else {
      throw new Error(`API update failed: ${error.message}`);
    }
  }
}

/**
 * Full resolution workflow: on-chain + backend update
 */
export async function resolveMarket(
  marketId: string,
  resolvedValue: number
): Promise<{ transactionDigest: string }> {
  console.log('\n🎯 Starting market resolution...');
  console.log(`═══════════════════════════════`);
  console.log(`Market ID: ${marketId}`);
  console.log(`Resolved Value: ${resolvedValue}`);
  
  try {
    // Step 1: Resolve on-chain
    const transactionDigest = await resolveMarketOnChain(marketId, resolvedValue);
    
    // Step 2: Update backend
    await updateBackendAPI(marketId, resolvedValue);
    
    console.log('\n🎉 Market Resolution Complete!');
    console.log(`═══════════════════════════════`);
    console.log(`✅ Transaction: ${transactionDigest}`);
    console.log(`✅ Backend Updated`);
    
    return { transactionDigest };
    
  } catch (error: any) {
    console.error(`❌ Resolution failed: ${error.message}`);
    throw error;
  }
}
