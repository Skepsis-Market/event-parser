#!/usr/bin/env ts-node

/**
 * Admin Script: Distribute USDC
 * Distributes USDC to a list of wallets from a JSON file
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import CONFIG from '../config/env';

const USDC_TYPE = CONFIG.usdcType;
const NETWORK = CONFIG.suiNetwork;
const SUI_RPC_URL = CONFIG.suiRpcUrl;

interface WalletExport {
  total_unique_wallets: number;
  waitlist_wallets: number;
  trading_wallets: number;
  sponsored_wallets: number;
  wallets: string[];
}

interface DistributionConfig {
  amountPerWallet: number; // In USDC (human readable, e.g., 200)
  walletFile: string;      // Path to JSON file with wallet addresses
}

async function distributeUSDC(config: DistributionConfig) {
  console.log('💰 Admin: USDC Distribution');
  console.log('═══════════════════════════');
  
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
  const adminAddress = keypair.getPublicKey().toSuiAddress();
  
  console.log(`📝 Admin: ${adminAddress.slice(0, 10)}...`);
  console.log(`🌐 Network: ${NETWORK}`);
  
  // Load wallet list
  const fs = await import('fs');
  const walletData: WalletExport = JSON.parse(fs.readFileSync(config.walletFile, 'utf-8'));
  const recipients = walletData.wallets;
  
  console.log(`📋 Recipients: ${recipients.length} wallets`);
  console.log(`💵 Amount per wallet: ${config.amountPerWallet} USDC`);
  
  // Convert to micro-USDC (6 decimals)
  const microUsdcPerWallet = config.amountPerWallet * 1_000_000;
  const totalMicroUsdc = microUsdcPerWallet * recipients.length;
  
  console.log(`💰 Total distribution: ${totalMicroUsdc / 1_000_000} USDC (${totalMicroUsdc} micro-USDC)`);
  
  // Step 1: Get USDC coins from admin wallet
  console.log('\n💰 Step 1/3: Checking admin USDC balance...');
  
  const usdcCoins = await client.getCoins({
    owner: adminAddress,
    coinType: USDC_TYPE,
  });
  
  if (!usdcCoins.data || usdcCoins.data.length === 0) {
    throw new Error('No USDC coins found in admin wallet');
  }
  
  const totalBalance = usdcCoins.data.reduce(
    (sum, coin) => sum + BigInt(coin.balance), 
    0n
  );
  
  console.log(`💵 Admin Balance: ${Number(totalBalance) / 1_000_000} USDC`);
  console.log(`💵 Required: ${totalMicroUsdc / 1_000_000} USDC`);
  
  if (totalBalance < BigInt(totalMicroUsdc)) {
    throw new Error(`Insufficient USDC balance. Need ${totalMicroUsdc / 1_000_000} USDC, have ${Number(totalBalance) / 1_000_000} USDC`);
  }
  
  // Step 2: Distribute USDC
  console.log('\n💸 Step 2/3: Creating distribution transaction...');
  
  const tx = new Transaction();
  
  // Merge all USDC coins
  let baseCoin;
  if (usdcCoins.data.length === 1) {
    baseCoin = tx.object(usdcCoins.data[0].coinObjectId);
  } else {
    const [firstCoin, ...restCoins] = usdcCoins.data;
    baseCoin = tx.object(firstCoin.coinObjectId);
    if (restCoins.length > 0) {
      tx.mergeCoins(
        baseCoin,
        restCoins.map(coin => tx.object(coin.coinObjectId))
      );
    }
  }
  
  // Split and transfer to each recipient
  for (const recipient of recipients) {
    const [coin] = tx.splitCoins(baseCoin, [tx.pure.u64(microUsdcPerWallet)]);
    tx.transferObjects([coin], tx.pure.address(recipient));
  }
  
  // Step 3: Execute transaction
  console.log('\n🚀 Step 3/3: Executing distribution...');
  
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
    requestType: 'WaitForLocalExecution'
  });
  
  console.log(`✅ Transaction: ${result.digest}`);
  
  // Show distribution results
  console.log('\n📊 Distribution Summary:');
  console.log('═══════════════════════════');
  
  recipients.forEach((wallet, index) => {
    console.log(`✅ ${index + 1}. ${wallet.slice(0, 10)}...${wallet.slice(-6)} → ${config.amountPerWallet} USDC`);
  });
  
  console.log('\n🎉 DISTRIBUTION COMPLETE!');
  console.log('═══════════════════════════');
  console.log(`✅ Total Recipients: ${recipients.length}`);
  console.log(`✅ Total Distributed: ${totalMicroUsdc / 1_000_000} USDC`);
  console.log(`✅ Transaction: ${result.digest}`);
  console.log(`✅ Network: ${NETWORK}`);
  
  return { transactionDigest: result.digest, recipientCount: recipients.length };
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: npm run admin:distribute <amount-per-wallet> <wallet-file.json>');
    console.log('\nExample:');
    console.log('  npm run admin:distribute 200 wallets-export-2025-11-06.json');
    console.log('\nArguments:');
    console.log('  amount-per-wallet: USDC amount to send to each wallet (e.g., 200)');
    console.log('  wallet-file.json:  JSON file containing wallet addresses');
    process.exit(1);
  }
  
  const amountPerWallet = parseFloat(args[0]);
  const walletFile = args[1];
  
  if (isNaN(amountPerWallet) || amountPerWallet <= 0) {
    console.error('❌ Invalid amount. Must be a positive number.');
    process.exit(1);
  }
  
  await distributeUSDC({
    amountPerWallet,
    walletFile
  });
}

if (require.main === module) {
  main().catch(console.error);
}

export { distributeUSDC };
