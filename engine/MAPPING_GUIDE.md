# Deriverse Dashboard: Professional Mapping & Integration Guide

This document maps the **v1.7.2 API** JSON outputs to the advanced financial metrics required for your dashboard.

---

## 1. Asset & Equity Metrics
**Endpoint**: `GET /accounts/{wallet}`

| Dashboard Label | JSON Field | Logic / Calculation |
| :--- | :--- | :--- |
| **Available USDC** | `balances[]` where `symbol == "USDC"` | Use `ui_amount`. This is your dry powder. |
| **Position Value** | `balances[]` where `tag == 4` | Total value of active perpetual contracts. |
| **Account Health** | `points` | Internal protocol loyalty/health score. |

---

## 2. Performance & PnL Metrics
**Endpoint**: `GET /trades/{wallet}`

### A. Total Realized PnL
*   **Logic**: Iterate through `logs` where `type == "spotFillOrder"` or `perpFillOrder`.
*   **Formula**: `sum(log.data.crncy where side == 1) - sum(log.data.crncy where side == 0)`.
*   **Refinement**: Subtract `spotFees` or `perpFees` from the result to get **Net PnL**.

### B. Trading Volume
*   **Logic**: Cumulative sum of the `crncy` or `qty * price` fields.
*   **Metric**: `Total Volume = SUM(logs.data.crncy)`.

### C. Win Rate %
*   **Logic**: Group fills by `orderId`. 
*   **Winning Trade**: A group of logs where total `crncy` inflow (Sell) > total `crncy` outflow (Buy).
*   **Formula**: `(Wins / Total Closed Trades) * 100`.

---

## 3. Risk Management & Analysis
### A. Fee Composition
*   **Taker Fees**: Found in `logs` where `type == "spotFees"`.
*   **Maker Rebates**: Found in `logs` where `type == "spotFillOrder"` as the `rebates` field.
*   **Visual**: Use a Pie Chart comparing `Fees Paid` vs `Rebates Earned`.

### B. Average Trade Duration
*   **Logic**: Diff between the `timestamp` of a `PlaceOrder` and its corresponding `FillOrder`.
*   **Formula**: `Average(Fill_Time - Place_Time)`.

---

## 4. UI Component Mapping (Modern Aesthetics)

| Component | Color Scheme | Data Trigger |
| :--- | :--- | :--- |
| **PnL Card** | Green (#00FF00) if PnL > 0 | `Total Realized PnL` |
| **Volume Chart** | Gradient Blue/Purple | `SUM(crncy) grouped by day` |
| **Fee Tracker** | Alert Orange (#FFA500) | `Total Fees Paid` |
| **L/S Gauge** | Dual Color (Red/Green) | `Ratio of Long vs Short tags` |

---

## 5. Implementation Notes
1.  **BigInt Handling**: All large numbers are returned as **Strings** to prevent rounding errors in JavaScript/Python. Wrap them in `Decimal()` or `float()` before calculating.
2.  **Symbol Mapping**: Use `GET /markets/list` to map `instrId: 0` to "SOL/USDC" in your UI tables.
3.  **Real-time Updates**: Use the `/markets/{id}/orderbook` endpoint every 5 seconds to update the "Current Market Price" in your dashboard cards.
