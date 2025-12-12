/**
 * Split gas coins for parallel transaction execution
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import CONFIG from '../config/env';

async function splitGasCoins() {
  console.log('\n💰 Splitting Gas Coins for Parallel Execution');
  console.log('═══════════════════════════════════════════════\n');

  const client = new SuiClient({ 
    url: CONFIG.suiNetwork === 'localnet' 
      ? CONFIG.suiRpcUrl
      : getFullnodeUrl(CONFIG.suiNetwork as any)
  });

  const keypair = Ed25519Keypair.fromSecretKey(CONFIG.suiPrivateKey);
  const address = keypair.toSuiAddress();

  // Check current coins
  const coins = await client.getCoins({
    owner: address,
    coinType: '0x2::sui::SUI'
  });

  console.log(`📊 Current state: ${coins.data.length} SUI coin(s)`);
  coins.data.forEach((coin, i) => {
    console.log(`   Coin ${i + 1}: ${coin.coinObjectId.slice(0, 10)}... = ${Number(coin.balance) / 1_000_000_000} SUI`);
  });

  if (coins.data.length >= 5) {
    console.log('\n✅ Already have enough coins for parallel execution!');
    return;
  }

  console.log('\n🔪 Splitting coins...');

  const splitAmount = 500_000_000; // 0.5 SUI per coin
  const numSplits = 5;

  const tx = new Transaction();
  tx.setSender(address);
  
  // Split into 5 new coins, one at a time
  // Each split returns a TransactionResult that we can transfer
  const splitCoinsArray: any[] = [];
  for (let i = 0; i < numSplits; i++) {
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(splitAmount)]);
    splitCoinsArray.push(coin);
  }
  
  // Transfer all split coins back to self - they remain as SEPARATE coin objects
  tx.transferObjects(splitCoinsArray, tx.pure.address(address));

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
    requestType: 'WaitForLocalExecution'
  });

  console.log(`✅ Split successful: ${result.digest}`);

  // Check new state
  const newCoins = await client.getCoins({
    owner: address,
    coinType: '0x2::sui::SUI'
  });

  console.log(`\n📊 New state: ${newCoins.data.length} SUI coin(s)`);
  newCoins.data.forEach((coin, i) => {
    console.log(`   Coin ${i + 1}: ${coin.coinObjectId.slice(0, 10)}... = ${Number(coin.balance) / 1_000_000_000} SUI`);
  });

  console.log('\n✅ Ready for parallel transaction execution!\n');
}

splitGasCoins().catch(error => {
  console.error('\n❌ Failed:', error);
  process.exit(1);
});
