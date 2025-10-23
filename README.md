# Skepsis Event Parser

Microservice for parsing Sui blockchain events and reconciling positions for Skepsis prediction markets.

## Features

- 📡 **WebSocket Event Listener**: Real-time event streaming via Sui subscribeEvent API
- 🔄 **Reconciliation**: Calculate final positions and PnL after market resolution
- 💾 **MongoDB Storage**: Append-only trades + reconciled positions
- ⚡ **Live Updates**: Instant event processing as they occur on-chain

## Setup

1. **Install dependencies**
```bash
npm install
```

2. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your MongoDB URI, Sui RPC URL, and Package ID
```

3. **Initialize database** (automatic on first run)
```bash
npm start
```

## Usage

### Start Event Listener
```bash
npm start
```

Establishes WebSocket connection to Sui RPC and listens for events in real-time.

### Run Reconciliation
```bash
npm run reconcile <marketId> <resolutionValue>
```

Example:
```bash
npm run reconcile 0x123abc... 105000
```

Calculates final positions and PnL for all traders in the resolved market.

## Database Schema

### Collections

- **`trades`**: Append-only log of all trading activity (BUY, SELL, CLAIM)
- **`positions`**: Reconciled positions with final PnL after market resolution
- **`indexer_state`**: Checkpoint tracking for resumable indexing

### Indexes

- `trades.tx_hash` (unique) - Prevent duplicate events
- `trades.{user, market_id}` - Fast user/market queries
- `positions.{user, market_id, range.start, range.end}` (unique) - Position lookup

## Project Structure

```
src/
├── db/
│   ├── connection.ts    # MongoDB connection
│   └── init.ts          # Schema initialization
├── sui/
│   └── client.ts        # Sui client config
├── indexer/
│   ├── handlers.ts      # Event handlers
│   └── listener.ts      # WebSocket subscription service
├── reconciliation/
│   └── reconcile.ts     # Position reconciliation
├── index.ts             # Event listener entry point
└── reconcile.ts         # CLI reconciliation tool
```

## Environment Variables

```bash
# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=skepsis

# Sui Network
SUI_RPC_URL=https://fullnode.testnet.sui.io:443

# Contract
PACKAGE_ID=0x...
```

## Development

```bash
# Watch mode (auto-restart on changes)
npm run dev

# Build TypeScript
npm run build
```

## Notes

- All values stored in micro-units (÷1,000,000 for display)
- WebSocket connection auto-reconnects on disconnection
- Idempotent event processing (duplicate tx_hash ignored)
- Graceful shutdown on SIGINT (Ctrl+C)
