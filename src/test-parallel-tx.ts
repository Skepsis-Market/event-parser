/**
 * Test script to verify parallel transaction execution with SUI coin management
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import CONFIG from './config/env';

const NETWORK = CONFIG.suiNetwork;
const SUI_RPC_URL = CONFIG.suiRpcUrl;

async function testParallelTransactions() {
  console.log('\n🧪 Testing Parallel Transaction Execution');
  console.log('═══════════════════════════════════════════\n');

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
  const sender = keypair.toSuiAddress();

  console.log(`📤 Sender: ${sender}`);

  // Create a dummy recipient address (we'll just send to ourselves)
  const recipient = sender;

  console.log(`📥 Recipient: ${recipient}`);

  // Check initial SUI balance
  const initialCoins = await client.getCoins({
    owner: sender,
    coinType: '0x2::sui::SUI'
  });

  console.log(`\n💰 Initial state:`);
  console.log(`   Available SUI coins: ${initialCoins.data.length}`);
  initialCoins.data.forEach((coin, i) => {
    console.log(`   Coin ${i + 1}: ${coin.coinObjectId.slice(0, 10)}... = ${Number(coin.balance) / 1_000_000_000} SUI`);
  });

  // Create 3 transactions that will execute in parallel
  const numTransactions = 3;
  const amountPerTx = 1_000_000; // 0.001 SUI per tx

  console.log(`\n🚀 Creating ${numTransactions} transactions to execute in parallel...`);
  console.log(`   Amount per tx: ${amountPerTx / 1_000_000_000} SUI\n`);

  // Strategy 1: Let SDK auto-select gas coins (default behavior)
  console.log('📋 Strategy 1: SDK Auto-Selection (firing at EXACT same time)');
  
  // Build all transactions first (synchronously)
  const transactions = [];
  for (let i = 0; i < numTransactions; i++) {
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountPerTx)]);
    tx.transferObjects([coin], tx.pure.address(recipient));
    transactions.push(tx);
    console.log(`   Prepared transaction ${i + 1}/${numTransactions}`);
  }

  console.log('\n🚀 Firing all transactions simultaneously NOW!\n');
  
  // Fire all transactions at the EXACT same time
  const promises1 = transactions.map((tx, i) => {
    return client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
      requestType: 'WaitForLocalExecution'
    }).then(result => {
      console.log(`   ✅ Transaction ${i + 1} succeeded: ${result.digest.slice(0, 10)}...`);
      return result;
    }).catch(error => {
      console.error(`   ❌ Transaction ${i + 1} failed: ${error.message}`);
      return { error: error.message, index: i + 1 };
    });
  });

  try {
    console.log('⏳ Waiting for all transactions to complete...\n');
    const results = await Promise.all(promises1);
    
    const succeeded = results.filter(r => !('error' in r));
    const failed = results.filter(r => 'error' in r);
    
    console.log(`\n📊 Results:`);
    console.log(`   ✅ Succeeded: ${succeeded.length}/${numTransactions}`);
    console.log(`   ❌ Failed: ${failed.length}/${numTransactions}`);
    
    if (failed.length > 0) {
      console.log(`\n❌ Failed transactions:`);
      failed.forEach((f: any) => {
        console.log(`   Transaction ${f.index}: ${f.error}`);
      });
    }
  } catch (error: any) {
    console.error(`\n❌ Strategy 1: Failed with error: ${error.message}`);
  }

  // Check final balance
  const finalCoins = await client.getCoins({
    owner: sender,
    coinType: '0x2::sui::SUI'
  });

  console.log(`\n💰 Final state:`);
  console.log(`   Available SUI coins: ${finalCoins.data.length}`);
  
  console.log('\n═══════════════════════════════════════════');
  console.log('✅ Test complete!\n');
}

// Run the test
testParallelTransactions().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
