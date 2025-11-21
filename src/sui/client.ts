import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import CONFIG from '../config/env';

export const suiClient = new SuiClient({
  url: CONFIG.suiRpcUrl
});

export const PACKAGE_ID = CONFIG.packageId;

// Event type filters - using events module
export const EVENT_TYPES = {
  BET_PLACED: `${PACKAGE_ID}::events::BetPlaced`,
  SHARES_SOLD: `${PACKAGE_ID}::events::SharesSold`,
  WINNINGS_CLAIMED: `${PACKAGE_ID}::events::WinningsClaimed`,
  MARKET_RESOLVED: `${PACKAGE_ID}::events::MarketResolved`,
  MARKET_CREATED: `${PACKAGE_ID}::events::MarketCreated`
};