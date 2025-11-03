/**
 * Environment Configuration Loader
 * Automatically switches between testnet and localnet configs based on ENVIRONMENT flag
 */

import * as dotenv from 'dotenv';

dotenv.config();

const ENVIRONMENT = (process.env.ENVIRONMENT || 'testnet').toLowerCase() as 'testnet' | 'localnet';

if (!['testnet', 'localnet'].includes(ENVIRONMENT)) {
  throw new Error(`Invalid ENVIRONMENT: ${ENVIRONMENT}. Must be 'testnet' or 'localnet'`);
}

/**
 * Dynamically load config based on ENVIRONMENT flag
 */
function getConfig(key: string): string {
  const envKey = `${ENVIRONMENT.toUpperCase()}_${key}`;
  const value = process.env[envKey];
  
  if (!value) {
    throw new Error(`Missing config: ${envKey} not found in .env`);
  }
  
  return value;
}

/**
 * Exported Configuration
 * All values automatically resolve to the active environment
 */
export const CONFIG = {
  // Environment info
  environment: ENVIRONMENT,
  isDev: ENVIRONMENT === 'localnet',
  isProd: ENVIRONMENT === 'testnet',

  // Network
  suiNetwork: getConfig('SUI_NETWORK'),
  suiRpcUrl: getConfig('SUI_RPC_URL'),

  // Contract IDs
  packageId: getConfig('PACKAGE_ID'),
  marketRegistry: getConfig('MARKET_REGISTRY'),
  adminCap: getConfig('ADMIN_CAP'),
  usdcType: getConfig('USDC_TYPE'),

  // API
  apiBaseUrl: getConfig('API_BASE_URL'),

  // Private key (same for both environments)
  suiPrivateKey: process.env.SUI_PRIVATE_KEY!,

  // MongoDB (same for both environments)
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
  mongodbDb: '', // Will be extracted from URI
};

// Validation
if (!CONFIG.suiPrivateKey) {
  throw new Error('SUI_PRIVATE_KEY not set in .env');
}

// Extract DB name from URI (mongodb://user:pass@host:port/dbname?options)
const extractDbName = (uri: string): string => {
  const match = uri.match(/\/([^/?]+)(\?|$)/);
  return match ? match[1] : 'skepsis';
};

CONFIG.mongodbDb = extractDbName(CONFIG.mongodbUri);

// Log active environment on startup
console.log(`✅ Configuration loaded for: ${CONFIG.environment.toUpperCase()}`);
console.log(`   Network: ${CONFIG.suiNetwork}`);
console.log(`   RPC: ${CONFIG.suiRpcUrl}`);

export default CONFIG;
