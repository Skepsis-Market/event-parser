import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import dotenv from 'dotenv';

dotenv.config();

// Use getFullnodeUrl for standard networks, or custom URL from env
const getSuiUrl = () => {
  const network = process.env.SUI_NETWORK || 'testnet';
  const customUrl = process.env.SUI_RPC_URL;
  
  // If custom URL is provided, use it (for localnet)
  if (customUrl) {
    return customUrl;
  }
  
  // Otherwise use standard network URLs
  return getFullnodeUrl(network as 'mainnet' | 'testnet' | 'devnet' | 'localnet');
};

export const suiClient = new SuiClient({
  url: getSuiUrl()
});

export const PACKAGE_ID = process.env.PACKAGE_ID!;

// Event type filters - using events module
export const EVENT_TYPES = {
  BET_PLACED: `${PACKAGE_ID}::events::BetPlaced`,
  SHARES_SOLD: `${PACKAGE_ID}::events::SharesSold`,
  WINNINGS_CLAIMED: `${PACKAGE_ID}::events::WinningsClaimed`,
  MARKET_RESOLVED: `${PACKAGE_ID}::events::MarketResolved`
};