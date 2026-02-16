# Deriverse Full Package API Documentation

This API exposes the internal capabilities of the `@deriverse/kit` through standardized REST endpoints.

## Base Configuration
- **Base URL**: `http://localhost:8080`
- **Content-Type**: `application/json`
- **Network**: Solana Devnet (Program: `Drvrseg8...`)
- **Port**: 8080

---

## 1. Spot Trading
**Place Spot Order**
- `POST /spot/order`
- **Body**: `{ "wallet": "...", "instrId": 1, "side": "buy", "price": 102.5, "qty": 1.0 }`
- **Logic**: Submits a Limit Order to the Spot Orderbook for the specified instrument.

---

## 2. Perpetual Futures Trading
**Place Perp Order**
- `POST /perp/order`
- **Body**: `{ "wallet": "...", "instrId": 12, "side": "buy", "price": 45000, "qty": 0.1, "leverage": 10 }`

---

## 3. Account Management
**Deposit Token**
- `POST /accounts/deposit`
- **Body**: `{ "wallet": "...", "tokenId": 1, "amount": 100 }`
- **Note**: `tokenId: 1` is USDC. Amount is in UI units (e.g., 100.0).

**Query Balances**
- `GET /accounts/:wallet`

---

## 4. Market Data
**Order Book Depth**
- `GET /markets/:id/orderbook`

**Historical Trade Data (Raw Logs)**
- `GET /trades/:wallet`
- **Returns**: Transaction signatures with decoded log reports

**Open Perpetual Orders**
- `GET /perp/openorders/:wallet`
- **Returns**: All open perpetual orders across all instruments:
  - `wallet`: Wallet address
  - `total_orders`: Total count of open orders
  - `orders`: Array of open orders with market, side, price, quantity, order_type

**Perpetual PnL Timeline**
- `GET /perp/pnl-timeline/:wallet?instrId=0&limit=1000`
- **Query Parameters**:
  - `instrId` (optional): Filter by specific instrument ID
  - `limit` (optional): Max transactions to fetch (default: 1000)
- **Returns**: Complete PnL history with chronological events
  - `wallet`: Wallet address
  - `total_events`: Total number of PnL events
  - `timeline`: Array of events (trades, funding, fees, socialized losses) with timestamps, cumulative PnL, position tracking
  - `summary`: Per-market summary with current position, realized PnL, fees, funding, and net PnL

