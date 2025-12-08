/**
 * Type definitions for Skepsis Event Parser
 */

export interface Trade {
  user: string;
  market_id: string;
  action: 'BUY' | 'SELL' | 'CLAIM';
  range: {
    start: bigint;
    end: bigint;
  };
  shares: bigint;
  amount: bigint;
  price_per_share?: bigint;
  probability?: bigint;
  tx_hash: string;
  block_number?: bigint;
  timestamp: bigint;
  indexed_at: Date;
}

export interface Position {
  user: string;
  market_id: string;
  range: {
    start: string;
    end: string;
  };
  trade_summary: {
    total_shares_bought: string;
    total_shares_sold: string;
    final_shares: string;
  };
  financial: {
    total_invested: string;
    total_received_sells: string;
    claim_amount: string;
    realized_pnl: string;
    avg_entry_price: string;
  };
  status: 'WINNING' | 'LOSING' | 'CLAIMED' | 'SOLD';
  resolved_at: string;
  reconciled_at: string;
  last_updated?: Date;
}

export interface IndexerState {
  _id: string;
  value: string;
  updated_at: Date;
}

// Sui Event Types
export interface BetPlacedEvent {
  user: string;
  market_id: string;
  range_start: string;
  range_end: string;
  shares_received: string;
  bet_amount: string;
  probability_at_purchase: string;
  price_per_share: string;
  timestamp?: string;
}

export interface SharesSoldEvent {
  user: string;
  market_id: string;
  range_start: string;
  range_end: string;
  shares_sold: string;
  amount_received: string;
  price_per_share: string;
  timestamp?: string;
}

export interface WinningsClaimedEvent {
  user: string;
  market_id: string;
  range_start: string;
  range_end: string;
  shares_claimed: string;
  payout_amount: string;
  timestamp?: string;
}

export interface SuiEventId {
  txDigest: string;
  eventSeq: string;
  timestampMs?: string;  // Blockchain timestamp in milliseconds
  checkpoint?: string;   // Sui checkpoint sequence number
}
