# Market Templates

This directory contains reusable market configuration templates organized by market type.

## Directory Structure

```
templates/
├── crypto/          # Cryptocurrency price prediction markets
├── temperature/     # Weather/temperature markets
├── percentage/      # Percentage-based markets (inflation, approval ratings)
└── bps/            # Basis points markets (Fed rates, bond yields)
```

## Template Types

### 1. Crypto Markets (`crypto/`)

**Templates:**
- `btc-template.json` - Bitcoin (BTC/USD)
- `eth-template.json` - Ethereum (ETH/USD)
- `sui-template.json` - Sui (SUI/USD)

**Configuration:**
- **BTC/ETH**: Large values ($90K-$110K, $3K-$4K)
  - `decimalPrecision: 0` (integer dollars)
  - `useKSuffix: true` (displays as $90K-$110K)
- **SUI**: Small values ($1.50-$3.50)
  - `decimalPrecision: 2` (cents precision)
  - `useKSuffix: false` (displays as $1.50-$3.50)

**Price Feeds:** CoinGecko API

---

### 2. Temperature Markets (`temperature/`)

**Templates:**
- `fahrenheit-template.json` - Temperature in °F
- `celsius-template.json` - Temperature in °C

**Configuration:**
- `decimalPrecision: 0` (whole degrees)
- `valueType: "temperature"`
- `valueSuffix: "°F"` or `"°C"`
- `useKSuffix: false`
- Range examples: 60°F-90°F or 15°C-32°C

**Data Sources:** Weather APIs (OpenWeatherMap, Weather.gov, etc.)

---

### 3. Percentage Markets (`percentage/`)

**Templates:**
- `inflation-template.json` - CPI inflation rate
- `approval-rating-template.json` - Political approval ratings

**Configuration:**
- `decimalPrecision: 2` (e.g., 3.25% = 325)
- `valueType: "percentage"`
- `valueSuffix: "%"`
- `useKSuffix: false`
- **Inflation**: 2.00%-4.00% (minValue: 200, maxValue: 400)
- **Approval**: 35.00%-55.00% (minValue: 3500, maxValue: 5500)

**Data Sources:** BLS (inflation), polling aggregators (approval)

---

### 4. Basis Points (BPS) Markets (`bps/`)

**Templates:**
- `fed-rate-template.json` - Federal Reserve interest rate

**Configuration:**
- `decimalPrecision: 0` (values already in BPS)
- `valueType: "bps"`
- `valueSuffix: " bps"`
- `useKSuffix: false`
- Range: 425-525 bps (4.25%-5.25%)

**Special Notes:**
- Values are **already in basis points** (no conversion needed)
- 1 basis point = 0.01%
- Fed rate 4.75% = 475 bps
- If Fed announces a range (e.g., 4.50%-4.75%), use **upper bound** (475)

**Data Sources:** Federal Reserve official announcements, FRED API

---

## Fed BPS Rate Explanation

### Why BPS as a Distinct Type?

**Option 1: Store as BPS (CHOSEN)**
- `decimalPrecision: 0`
- `valueType: "bps"`
- Store: 475 (represents 475 basis points = 4.75%)
- Display: "475 bps" or "4.75%"
- ✅ **Clearest approach** - no mental math needed

**Option 2: Store as Percentage with decimals (NOT USED)**
- `decimalPrecision: 2`
- Store: 475 (represents 4.75%)
- Display: "4.75%"
- ❌ **Confusing** - 475 looks like a large number but represents 4.75%

### Fed Rate Mechanics

Current Fed rate (Nov 2025): **4.50% - 4.75%**
- Lower bound: 450 bps
- Upper bound: 475 bps
- **Market resolves to upper bound: 475**

### Resolution Examples

| Fed Announcement | Upper Bound | Market Resolution Value |
|-----------------|-------------|------------------------|
| 4.25% - 4.50%   | 4.50%       | 450 bps               |
| 4.50% - 4.75%   | 4.75%       | 475 bps               |
| 4.75% - 5.00%   | 5.00%       | 500 bps               |
| 5.00% - 5.25%   | 5.25%       | 525 bps               |

### Display Options

Frontend can display either:
1. **BPS format**: "475 bps"
2. **Percentage format**: "4.75%"
3. **Both**: "475 bps (4.75%)"

Backend should store the raw BPS value (475) and let frontend format it.

---

## Using Templates

### 1. Copy Template
```bash
cp templates/crypto/btc-template.json my-btc-market.json
```

### 2. (Optional) Upload Market Image

**Upload image manually to avoid duplicates:**

```bash
# Testnet
curl -X POST https://api.skepsis.live/api/markets/upload-image \
  -H "x-admin-secret: YOUR_TESTNET_ADMIN_SECRET" \
  -F "image=@/path/to/bitcoin-image.jpg"

# Localnet
curl -X POST http://localhost:3001/api/markets/upload-image \
  -H "x-admin-secret: YOUR_LOCALNET_ADMIN_SECRET" \
  -F "image=@/path/to/bitcoin-image.jpg"
```

**Response:**
```json
{
  "success": true,
  "url": "https://skepsis-markets.s3.us-east-1.amazonaws.com/markets/abc-123.jpg",
  "key": "markets/abc-123.jpg"
}
```

**Why manual upload?**
- Prevents duplicate uploads for the same image
- Gives you control over image assets
- Can reuse the same image URL across multiple markets

### 3. Fill in Placeholders

Replace bracketed values:
- `[DATE]` - Target date (e.g., "November 15, 2025")
- `[TIMESTAMP_MS]` - Unix timestamp in milliseconds
- `[CURRENT_PRICE]` - Current market price
- `[TIME]` - Resolution time (e.g., "20:00:00")
- `[MIN_VALUE]` / `[MAX_VALUE]` - Value range
- `[FORMATTED_*]` - Human-readable formatted values
- `[OPTIONAL_S3_URL]` - S3 URL from step 2 (or remove if no image)
- `[OPTIONAL_S3_KEY]` - S3 key from step 2 (or remove if no image)

**Note:** If you don't want to add an image, simply remove the `marketImage` and `marketImageKey` fields from the JSON.

### 4. Create Market
```bash
npm run admin:create my-btc-market.json
```

---

## Formatting Field Reference

| Field | Type | Description | Example Values |
|-------|------|-------------|----------------|
| `valueType` | string | Market value type | `"currency"`, `"percentage"`, `"temperature"`, `"bps"` |
| `valuePrefix` | string | Prefix before value | `"$"` (currency), `""` (others) |
| `valueSuffix` | string | Suffix after value | `"%"` (percentage), `"°F"` (temp), `" bps"` (bps) |
| `useKSuffix` | boolean | Use K suffix for large numbers | `true` ($90K), `false` ($1.50) |
| `decimalPrecision` | number | Decimal places for scaling | `0` (BTC), `2` (SUI, %) |
| `marketImage` | string | **Optional** S3 URL | `"https://skepsis-markets.s3...jpg"` |
| `marketImageKey` | string | **Optional** S3 key | `"markets/abc-123.jpg"` |

---

## Value Scaling Logic

The `decimalPrecision` field determines how raw values are scaled for on-chain storage:

| Precision | Raw Value | Scaled Value | Example |
|-----------|-----------|--------------|---------|
| 0 | $95,432.67 | 95,432 | Bitcoin price |
| 2 | $2.17 | 217 | SUI price (cents) |
| 2 | 3.25% | 325 | Inflation rate |
| 0 | 475 bps | 475 | Fed rate (already BPS) |

**Formula:** `scaledValue = floor(rawValue × 10^decimalPrecision)`

---

## Quick Reference

### Crypto (Large Cap)
```json
{
  "decimalPrecision": 0,
  "valueType": "currency",
  "valuePrefix": "$",
  "useKSuffix": true
}
```

### Crypto (Small Cap / Altcoin)
```json
{
  "decimalPrecision": 2,
  "valueType": "currency",
  "valuePrefix": "$",
  "useKSuffix": false
}
```

### Temperature
```json
{
  "decimalPrecision": 0,
  "valueType": "temperature",
  "valueSuffix": "°F",
  "useKSuffix": false
}
```

### Percentage
```json
{
  "decimalPrecision": 2,
  "valueType": "percentage",
  "valueSuffix": "%",
  "useKSuffix": false
}
```

### Basis Points
```json
{
  "decimalPrecision": 0,
  "valueType": "bps",
  "valueSuffix": " bps",
  "useKSuffix": false
}
```
