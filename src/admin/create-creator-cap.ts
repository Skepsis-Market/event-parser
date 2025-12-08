#!/usr/bin/env ts-node

/**
 * Create Creator Capability
 * One-time script to create a CreatorCap and save it to .env
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import * as fs from 'fs';
import * as path from 'path';
import CONFIG from '../config/env';

const PACKAGE_ID = CONFIG.packageId;
const ADMIN_CAP = CONFIG.adminCap;
const NETWORK = CONFIG.suiNetwork;
const SUI_RPC_URL = CONFIG.suiRpcUrl;

async function createCreatorCap(): Promise<string> {
  console.log('🔧 Creating Creator Capability');
  console.log('═══════════════════════════════');
  console.log(`🌐 Network: ${NETWORK}`);
  console.log(`📦 Package: ${PACKAGE_ID}`);
  console.log(`🔑 Admin Cap: ${ADMIN_CAP}\n`);
  
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
  
  console.log(`👤 Signer: ${signerAddress}\n`);
  
  // Create creator capability
  console.log('📝 Creating transaction...');
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::registry::create_creator_cap_entry`,
    arguments: [
      tx.object(ADMIN_CAP),
      tx.pure.address(signerAddress),
    ]
  });
  
  console.log('✍️  Signing and executing...');
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showObjectChanges: true },
    requestType: 'WaitForLocalExecution'
  });
  
  console.log(`✅ Transaction: ${result.digest}\n`);
  
  // Find the created CreatorCap object
  const creatorCapObj = result.objectChanges?.find(
    (change: any) => change.type === 'created' && 
    change.objectType?.includes('::registry::CreatorCap')
  );
  
  if (!creatorCapObj) {
    throw new Error('CreatorCap not found in transaction results');
  }
  
  const creatorCapId = (creatorCapObj as any).objectId;
  console.log('✅ Creator Capability Created!');
  console.log('═══════════════════════════════');
  console.log(`🆔 Creator Cap ID: ${creatorCapId}\n`);
  
  return creatorCapId;
}

async function updateEnvFile(creatorCapId: string) {
  const envPath = path.join(__dirname, '../../.env');
  
  console.log('📝 Updating .env file...');
  
  let envContent = fs.readFileSync(envPath, 'utf-8');
  
  // Determine which environment we're updating
  const envPrefix = NETWORK === 'localnet' ? 'LOCALNET' : 'TESTNET';
  const varName = `${envPrefix}_CREATOR_CAP`;
  
  // Check if the variable already exists
  const regex = new RegExp(`^${varName}=.*$`, 'm');
  
  if (regex.test(envContent)) {
    // Replace existing value
    envContent = envContent.replace(regex, `${varName}=${creatorCapId}`);
    console.log(`✅ Updated existing ${varName}`);
  } else {
    // Add new variable after ADMIN_CAP
    const adminCapLine = `${envPrefix}_ADMIN_CAP=`;
    const adminCapIndex = envContent.indexOf(adminCapLine);
    
    if (adminCapIndex === -1) {
      throw new Error(`Could not find ${envPrefix}_ADMIN_CAP in .env file`);
    }
    
    // Find the end of the line
    const lineEnd = envContent.indexOf('\n', adminCapIndex);
    
    // Insert new line after ADMIN_CAP
    const beforeInsert = envContent.substring(0, lineEnd + 1);
    const afterInsert = envContent.substring(lineEnd + 1);
    
    envContent = beforeInsert + `${varName}=${creatorCapId}\n` + afterInsert;
    console.log(`✅ Added new ${varName}`);
  }
  
  // Write back to file
  fs.writeFileSync(envPath, envContent, 'utf-8');
  console.log(`✅ .env file updated successfully!\n`);
}

async function main() {
  try {
    const creatorCapId = await createCreatorCap();
    await updateEnvFile(creatorCapId);
    
    console.log('🎉 SUCCESS!');
    console.log('═══════════════════════════════');
    console.log('Creator capability has been created and saved to .env');
    console.log('You can now use it for market creation without recreating each time.\n');
    
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
