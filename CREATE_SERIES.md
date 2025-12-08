# How to Create a Series for BTC Hourly Orchestration

## Step 1: Create the Series via API

Run this command to create the BTC Hourly series:

```bash
# For LOCALNET:
curl -X POST http://localhost:3001/api/series \
  -H "x-admin-secret: skepsis_admin_secret_key_2025" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "btc-hourly",
    "name": "Bitcoin Hourly",
    "frequency": "1h",
    "asset": "BTC",
    "packageId": "0x978e9a5a93d95f3eeef0b1b5f6be7096f506e265a01e6b4954417ccc1c773675",
    "network": "localnet",
    "nextSpawnTime": 0,
    "currentRoundNumber": 0,
    "template": {
      "category": "Cryptocurrency",
      "bucketCount": 10,
      "bucketWidth": 20,
      "decimalPrecision": 0,
      "valueUnit": "USD",
      "valueType": "currency",
      "valuePrefix": "$",
      "valueSuffix": "",
      "useKSuffix": false,
      "initialLiquidity": 1000000000,
      "usdcType": "0x96b49fae10b0bed8938e3b8f1110c323dac320bc6d0781a0c4cb71dc237342fa::usdc::USDC",
      "marketImage": "https://skepsis-markets-testnet.s3.us-east-1.amazonaws.com/markets/bb2a2168-3ad9-438d-8aac-7a0e2ff8f6ef.png",
      "marketImageKey": "markets/bb2a2168-3ad9-438d-8aac-7a0e2ff8f6ef.png",
      "priceFeed": "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true"
    }
  }'
```

## Step 2: Copy the Series ID

The API will return something like:

```json
{
  "_id": "674a8b3c1234567890abcdef",
  "slug": "btc-hourly",
  "name": "Bitcoin Hourly",
  ...
}
```

Copy the `_id` value.

## Step 3: Add to .env

Open `.env` and uncomment/update the series ID:

```env
# For LOCALNET:
LOCALNET_SERIES_ID=674a8b3c1234567890abcdef

# For TESTNET (when ready):
# TESTNET_SERIES_ID=your_testnet_series_id_here
```

## Step 4: Run the Orchestrator

```bash
npm run orchestrate:btc-hourly
```

The orchestrator will:
1. ✅ Fetch the current round number from the series (starts at 0)
2. ✅ Increment round number for each new market
3. ✅ Create markets with series tracking (seriesId, roundNumber, isSeriesMaster)
4. ✅ Update the series after each market creation with:
   - activeMarketId
   - currentRoundNumber
   - nextSpawnTime

## Features

### Series Tracking
- **seriesId**: Links the market to the series
- **roundNumber**: Sequential counter (1, 2, 3, ...)
- **isSeriesMaster**: `true` for the active round
- **nextSpawnTime**: When the next market will be created (resolution time + 1 minute)

### Error Handling
- If no SERIES_ID: Markets created without series tracking (⚠️ warning)
- If SERIES_ID invalid: Orchestrator exits with error (❌)
- If API fails: Error logged, continues to next market

### Validation
- Creator Cap must exist (run `npm run admin:create-creator-cap` if missing)
- Series ID fetched at startup to validate it exists
- Round number synchronized from backend

## Testnet Setup (When Ready)

1. Switch environment:
   ```env
   ENVIRONMENT=testnet
   ```

2. Create testnet creator cap (if not done):
   ```bash
   npm run admin:create-creator-cap
   ```

3. Create testnet series:
   ```bash
   curl -X POST https://api.skepsis.live/api/series \
     -H "x-admin-secret: skepsis_Rero_Zero0_control" \
     -H "Content-Type: application/json" \
     -d '{
       "slug": "btc-hourly",
       "name": "Bitcoin Hourly",
       "frequency": "1h",
       "asset": "BTC",
       "packageId": "0x0951e5185cc4cfd214a490f6bf3404337d1ed071ff8b3bc539f94463dbe5610e",
       "network": "testnet",
       "nextSpawnTime": 0,
       "currentRoundNumber": 0,
       "template": { ... }
     }'
   ```

4. Add TESTNET_SERIES_ID to .env

5. Run orchestrator

## Monitoring

Watch the logs for:
- 🔢 Round Number increments
- ✅ Series Update success
- ⚠️ API warnings (non-fatal)
- ❌ Fatal errors (stops orchestrator)

## Production Mode

When ready for hourly production (not 5-minute test mode):

1. Update `msUntilNextHour()` to calculate top of hour instead of 5-minute intervals
2. Update resolution time from 5 minutes to 1 hour
3. Update `nextSpawnTime` calculation if needed
4. Test thoroughly on testnet first!
