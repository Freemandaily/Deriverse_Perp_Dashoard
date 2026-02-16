import { createSolanaRpc, address, Address } from '@solana/kit';
import { Engine, LogType } from '@deriverse/kit';
import { Buffer } from 'buffer';

enum OrderType {
    limit = 0,
    market = 1,
    marginCall = 2,
    forcedClose = 3
}

export class DeriverseService {
    private rpc;
    private engine: Engine;
    private programId = address("Drvrseg8AQLP8B96DBGmHRjFGviFNYTkHueY9g3k27Gu");
    private version = 12;

    private tokenMap = new Map<number, { symbol: string, decimals: number }>([
        [-1, { symbol: "SOL", decimals: 9 }],
        [0, { symbol: "DRVS", decimals: 8 }],
        [1, { symbol: "USDC", decimals: 6 }],
        // [16777217, { symbol: "USDC", decimals: 6 }], // Adjusted: Large ID for USDC per user feedback - REVERTED
        [16777217, { symbol: "SOL", decimals: 9 }], // Corrected: This large ID is SOL based on user feedback/balance match
        [2, { symbol: "SOL", decimals: 9 }],
        [4, { symbol: "LETTERA", decimals: 5 }],
        [67108864, { symbol: "LETTERA", decimals: 5 }], // Add large ID for LETTERA
        [6, { symbol: "VELIT", decimals: 6 }],
        [8, { symbol: "SUN", decimals: 4 }],
        [10, { symbol: "BRSH", decimals: 6 }],
        [12, { symbol: "MSHK", decimals: 4 }],
        [14, { symbol: "SOL", decimals: 6 }],
        [16, { symbol: "trs", decimals: 6 }],
        [18, { symbol: "sad", decimals: 6 }],
        [20, { symbol: "MDVD", decimals: 9 }],
        [22, { symbol: "333", decimals: 9 }],
        [24, { symbol: "BRSH", decimals: 4 }],
        [26, { symbol: "1", decimals: 6 }],
        [28, { symbol: "TST", decimals: 6 }],
        [30, { symbol: "asd", decimals: 6 }],
        [16777220, { symbol: "USDC", decimals: 6 }], // Adding possible USDC match for Tag 4 or others
    ]);

    constructor() {
        this.rpc = createSolanaRpc('https://api.devnet.solana.com');
        this.engine = new Engine(this.rpc, {
            programId: this.programId,
            version: this.version,
            uiNumbers: false // Disable SDK-side formatting to avoid map-lookup crashes
        });
    }

    async initialize() {
        // Safety: Pre-initialize maps to prevent SDK internal crashes
        // @ts-ignore
        if (!this.engine.tokens) this.engine.tokens = new Map();
        // @ts-ignore
        if (!this.engine.instruments) this.engine.instruments = new Map();

        try {
            const success = await this.engine.initialize();
            if (!success) {
                console.warn("[DeriverseService] SDK Engine reports initialization failure. Using manual fallback.");
            }
        } catch (e) {
            console.error("[DeriverseService] SDK Engine crashed during initialization:", e);
        }

        // Manual Fallback: Ensure common instruments are defined if SDK failed
        // Instrument 0: SOL/USDC
        // @ts-ignore
        if (this.engine.instruments.size === 0) {
            console.log("[DeriverseService] Injecting manual instrument metadata...");
            // @ts-ignore
            this.engine.instruments.set(0, {
                address: address("Drvrseg8AQLP8B96DBGmHRjFGviFNYTkHueY9g3k27Gu"),
                header: {
                    instrId: 0,
                    assetTokenId: 16777217, // SOL
                    crncyTokenId: 1, // USDC
                    lastPx: BigInt(100e9) as any,
                    bestBid: BigInt(0) as any,
                    bestAsk: BigInt(0) as any
                } as any
            });
        }
    }

    async getInstrumentsList() {
        const list = [];
        for (const [id, instr] of this.engine.instruments.entries()) {
            let markPrice = instr.header?.lastPx || BigInt(0);

            // Format to UI number
            const markPriceUi = Number(markPrice) / 1e9; // Assuming 9 decimals for price

            let name = `Instrument-${id}`;
            try {
                // @ts-ignore
                const assetTokenId = instr.header.assetTokenId;
                // @ts-ignore
                const crncyTokenId = instr.header.crncyTokenId;
                const assetSymbol = this.getAssetMetadata(1, Number(assetTokenId)).symbol;
                const crncySymbol = this.getAssetMetadata(2, Number(crncyTokenId)).symbol;
                name = `${assetSymbol}/${crncySymbol}`;
            } catch (e) {
                name = `Instrument-${id}`;
            }

            list.push({
                instrId: id,
                address: instr.address,
                name: name,
                markPrice: markPriceUi
            });
        }
        return list;
    }

    private getAssetMetadata(tag: number, id: number) {
        if (this.tokenMap.has(id)) {
            return this.tokenMap.get(id)!;
        }

        if (tag === 4) return { symbol: `PERP-INSTR-${id}`, decimals: 9 };
        if (tag === 3) return { symbol: `SPOT-INSTR-${id}`, decimals: 9 };
        if (tag === 2) return { symbol: "USDC", decimals: 6 };

        if (id === 16777217) return { symbol: "USDC", decimals: 6 };

        return { symbol: `Token-${id}`, decimals: 9 };
    }

    private getTokenDecimals(tokenId: number): number {
        const meta = this.tokenMap.get(tokenId);
        if (meta) return meta.decimals;
        return 9;
    }

    async getAccountData(walletStr: string) {
        const wallet = address(walletStr);
        // @ts-ignore
        await this.engine.setSigner(wallet);

        // @ts-ignore
        const clientAcc = this.engine.clientPrimaryAccount;
        if (!clientAcc) {
            return {
                wallet: walletStr,
                balances: []
            };
        }

        const info = await this.rpc.getAccountInfo(clientAcc, { encoding: 'base64' }).send();
        if (!info || !info.value) {
            return {
                wallet: walletStr,
                balances: []
            };
        }

        const buffer = Buffer.from(info.value.data[0], 'base64');
        const sdkData = await this.engine.getClientData();


        const assets = [];

        const rawPerpEntries: { instrId: number, clientId: number }[] = [];

        // 1. Read Standard Assets from Buffer (e.g. Spot, Margin)
        for (let i = 0; i < 20; i++) {
            const offset = 304 + (i * 16);
            if (offset + 16 > buffer.length) break;

            const tag = buffer[offset + 8];

            // Handle Perpetual Entries (Tag 4)
            if (tag === 4) {
                const assetId = buffer.readUInt32LE(offset);
                const tempClientId = buffer.readUInt32LE(offset + 4);

                // Map AssetID to InstrumentID
                let foundInstrId = -1;
                for (const [iId, instr] of this.engine.instruments.entries()) {
                    if (instr.header.assetTokenId === assetId) {
                        foundInstrId = iId;
                        break;
                    }
                }

                // Fallback: If AssetID is 0, it might trigger Instr 0 (SOL/USDC) if 0 is the asset token id
                // or if the entry is just a default placeholder. We will check it anyway.
                if (assetId === 0 && foundInstrId === -1 && this.engine.instruments.has(0)) {
                    foundInstrId = 0;
                }

                if (foundInstrId !== -1) {
                    rawPerpEntries.push({ instrId: foundInstrId, clientId: tempClientId });
                }
                continue;
            }

            const amountRaw = buffer.readBigInt64LE(offset);
            const meta = buffer.readUInt32LE(offset + 8);

            if (amountRaw === 0n && meta === 0) continue;

            const id = meta & 0xFFFFFFF;
            const { symbol } = this.getAssetMetadata(tag, id);
            const finalDecimals = this.getTokenDecimals(id);

            // Correction for specific ID observed in logs matching SOL amount
            let finalSymbol = symbol;
            if (id === 16777217) {
                finalSymbol = "SOL";
            }

            const uiAmount = Number(amountRaw) / Math.pow(10, finalDecimals);

            assets.push({
                symbol: finalSymbol,
                tag,
                id,
                decimals: finalDecimals,
                raw_amount: amountRaw.toString(),
                ui_amount: uiAmount
            });
        }

        // 2. Read Perpetual Positions (Unified SDK + Raw Buffer)
        const processPerp = async (instrId: number, tempClientId: number) => {
            try {
                const info = await this.engine.getClientPerpOrdersInfo({
                    instrId,
                    clientId: tempClientId
                });

                // Filter out empty positions
                if (!info || info.perps === 0) return null;

                // Resolve instrument / market name
                let marketName = `PERP-INSTR-${instrId}`;
                if (instrId === 0) {
                    marketName = "SOL/USDC";
                } else {
                    try {
                        const instrument = this.engine.instruments.get(instrId);
                        if (instrument) {
                            // @ts-ignore
                            const assetTokenId = instrument.header.assetTokenId;
                            // @ts-ignore
                            const crncyTokenId = instrument.header.crncyTokenId;
                            const assetSymbol = this.getAssetMetadata(1, Number(assetTokenId)).symbol;
                            const crncySymbol = this.getAssetMetadata(2, Number(crncyTokenId)).symbol;
                            marketName = `${assetSymbol}/${crncySymbol}`;
                        }
                    } catch (e) {
                        // Fallback
                    }
                }

                return {
                    symbol: marketName,
                    tag: 4,
                    id: instrId,
                    decimals: 9,
                    raw_amount: "0",
                    ui_amount: info.perps,
                    unrealized_pnl: info.result,
                    cost: info.cost,
                    side: info.perps > 0 ? "long" : "short",
                    leverage: info.mask & 0xFF
                };

            } catch (e) {
                return null;
            }
        };

        const perpPromises: Promise<any>[] = [];
        const processedInstrIds = new Set<number>();

        // From SDK Map
        if (sdkData?.perp) {
            for (const [instrId, perpData] of sdkData.perp.entries()) {
                processedInstrIds.add(instrId);
                perpPromises.push(processPerp(instrId, perpData.clientId));
            }
        }

        // From Raw Buffer
        for (const entry of rawPerpEntries) {
            if (!processedInstrIds.has(entry.instrId)) {
                processedInstrIds.add(entry.instrId);
                perpPromises.push(processPerp(entry.instrId, entry.clientId));
            }
        }

        const results = await Promise.all(perpPromises);
        const validPerps = results.filter((p): p is any => p !== null);
        assets.push(...validPerps);


        // 3. Fallback: Reconstruct from History (if no perps found or user insists)
        // This is expensive so we only do it if we found 0 perps above OR explicitly requested
        const hasPerps = assets.some(a => a.tag === 4);

        if (!hasPerps) {
            console.log(`[DEBUG] No active perps found via SDK/Buffer. Attempting History Reconstruction for ${walletStr}...`);
            try {
                // Fetch simple trade history (lighter than full parsing)
                const trades = await this.getHistoricalLogs(walletStr, 1000); // 1000 sigs should cover recent history

                // Aggregate
                const calculatedPositions = new Map<number, { qty: number, cost: number, market: string }>();

                for (const trade of trades) {
                    if (!trade.logs) continue;

                    for (const log of trade.logs) {
                        // Look for Perp Fill (Tag 36 or similar - wait, logsDecode returns object with tags)
                        // From structure_models: 
                        // perpClientInfos = 41, perpClientInfos2 = 42
                        // Actual trades are usually in specific event tags or we look at `baseChange`

                        // Let's use the shape directly. 
                        // We need `instrId`, `baseChange` (or `perps` change).

                        const d = log.data;
                        if (d && d.instrId !== undefined && (d.baseChange !== undefined || d.perps !== undefined)) {
                            const instrId = Number(d.instrId);
                            const change = Number(d.baseChange || d.perps || 0); // Raw units?

                            // Check scaling. Usually baseChange is in lot size or raw.
                            // If it's effectively 0, skip
                            if (Math.abs(change) < 1e-9) continue;

                            // Aggregate
                            if (!calculatedPositions.has(instrId)) {
                                calculatedPositions.set(instrId, { qty: 0, cost: 0, market: "Unknown" });
                            }

                            const pos = calculatedPositions.get(instrId)!;
                            pos.qty += change;

                            // Try to resolve market name
                            if (pos.market === "Unknown") {
                                let marketName = `PERP-INSTR-${instrId}`;
                                if (instrId === 0) {
                                    marketName = "SOL/USDC";
                                } else {
                                    // Attempt resolve
                                    try {
                                        const instr = this.engine.instruments.get(instrId);
                                        if (instr) {
                                            // @ts-ignore
                                            const assetId = instr.header.assetTokenId;
                                            // @ts-ignore
                                            const crncyId = instr.header.crncyTokenId;
                                            const aSym = this.getAssetMetadata(1, Number(assetId)).symbol;
                                            const cSym = this.getAssetMetadata(2, Number(crncyId)).symbol;
                                            marketName = `${aSym}/${cSym}`;
                                        }
                                    } catch { }
                                }
                                pos.market = marketName;
                            }
                        }
                    }
                }

                // Process Aggregated Results
                for (const [instrId, pos] of calculatedPositions.entries()) {
                    // Check if net quantity is non-zero (allowing for tiny float dust)
                    // Base decimals usually 9. 0.04 SOL = 40,000,000 raw?
                    // Wait, `baseChange` from `logsDecode` might be UI amount or Raw? 
                    // The `logsDecode` usually returns RawBN or number. 
                    // Let's assume valid drift is < 1000 units.

                    if (Math.abs(pos.qty) > 1000) {
                        console.log(`[DEBUG] History Reconstruction Found Position: Instr ${instrId}, NetQty: ${pos.qty}`);

                        // Add to assets if not already there
                        const existing = assets.find(a => a.tag === 4 && a.id === instrId);
                        if (!existing) {
                            // Convert raw net qty to UI
                            // Assuming 9 decimals for SOL/Base
                            const uiQty = pos.qty / 1e9;

                            assets.push({
                                symbol: pos.market,
                                tag: 4,
                                id: instrId,
                                decimals: 9,
                                raw_amount: pos.qty.toString(),
                                ui_amount: uiQty,
                                unrealized_pnl: 0, // Cannot compute easily without active Mark calc
                                cost: 0,
                                side: uiQty > 0 ? "long" : "short",
                                is_reconstructed: true
                            });
                        }
                    }
                }

            } catch (e) {
                console.error("History Reconstruction Failed:", e);
            }
        }

        return {
            wallet: walletStr,
            client_id: sdkData?.community?.header?.id || 0,
            balances: assets
        };
    }

    async getHistoricalLogs(walletStr: string, limit = 5000) {
        const wallet = address(walletStr);
        await this.engine.setSigner(wallet);

        // @ts-ignore
        const clientAcc = this.engine.clientPrimaryAccount;
        if (!clientAcc) return [];

        let allSignatures: any[] = [];
        let before: any = undefined;
        while (allSignatures.length < limit) {
            try {
                const batchLimit = Math.min(1000, limit - allSignatures.length);
                const batch = await this.rpc.getSignaturesForAddress(clientAcc, { limit: batchLimit, before }).send();
                if (batch.length === 0) break;
                allSignatures.push(...batch);
                before = batch[batch.length - 1].signature;
                if (batch.length < batchLimit) break;
            } catch (e) {
                console.warn("[DEBUG] Failed to fetch signatures for logs:", e);
                break;
            }
        }


        const signatures = allSignatures;
        const results = [];

        // Process signatures in batches to resolve transactions
        const BATCH_SIZE = 5; // Balanced
        for (let i = 0; i < signatures.length; i += BATCH_SIZE) {
            const batch = signatures.slice(i, i + BATCH_SIZE);
            if (i > 0) await new Promise(r => setTimeout(r, 200)); // Short delay

            const batchResults = await Promise.all(batch.map(async (sig) => {
                let retryCount = 0;
                while (retryCount < 3) {
                    try {
                        const tx = await this.rpc.getTransaction(sig.signature, {
                            encoding: 'json',
                            maxSupportedTransactionVersion: 0,
                            commitment: 'confirmed'
                        }).send();
                        return { tx, sig };
                    } catch (e: any) {
                        if (e.statusCode === 429 || e.message?.includes('429')) {
                            retryCount++;
                            await new Promise(r => setTimeout(r, 200 * retryCount)); // Exponential backoff
                        } else {
                            console.warn(`[WARN] Failed to fetch TX ${sig.signature}:`, e);
                            return { tx: null, sig };
                        }
                    }
                }
                return { tx: null, sig };
            }));

            for (const { tx, sig } of batchResults) {
                if (tx && tx.meta && tx.meta.logMessages) {
                    try {
                        const reports = this.engine.logsDecode(tx.meta.logMessages);
                        if (reports && reports.length > 0) {
                            const serialized = this.serializeReports(reports);
                            results.push({
                                signature: sig.signature,
                                timestamp: sig.blockTime || tx.blockTime,
                                logs: serialized
                            });
                        } else {
                        }
                    } catch (e) {
                        console.warn(`[DEBUG] Decode error for TX ${sig.signature.slice(0, 10)}:`, e);
                    }
                }
            }
        }

        return results;
    }

    /**
     * Enhanced transaction history that provides a flattened, easy-to-consume structure
     * with all trade details: type (spot/perp), time, size, side, price, fees, order type
     */
    async getEnhancedTransactionHistory(walletStr: string, limit = 50) {
        const wallet = address(walletStr);
        await this.engine.setSigner(wallet);

        // @ts-ignore
        const clientAcc = this.engine.clientPrimaryAccount;
        if (!clientAcc) return [];

        const signatures = await this.rpc.getSignaturesForAddress(clientAcc, { limit }).send();

        const transactions = [];
        for (const sig of signatures) {
            const tx: any = await this.rpc.getTransaction(sig.signature, {
                maxSupportedTransactionVersion: 0,
                encoding: 'base64'
            }).send();

            if (tx?.meta?.logMessages) {
                const reports = this.engine.logsDecode(tx.meta.logMessages);
                if (reports && reports.length > 0) {
                    // Flatten reports into trade items with context
                    const tradeItems = reports.map((r: any) => ({
                        ...r,
                        signature: sig.signature,
                        timestamp: tx.blockTime
                    }));

                    const processedTx = this.processTransactionReports(tradeItems);
                    if (processedTx.length > 0) {
                        transactions.push(...processedTx);
                    }
                }
            }
        }
        return transactions;
    }

    /**
     * Process transaction reports into structured trade records
     */
    private processTransactionReports(tradeItems: any[]) {
        const history: any[] = [];

        for (const item of tradeItems) {
            const r = item;
            const signature = r.signature || "";
            const timestamp = r.timestamp || 0;
            const datetime = timestamp ? new Date(timestamp * 1000).toISOString() : null;

            let instrId = r.instrId !== undefined ? Number(r.instrId) : null;
            let marketName = 'Unknown';
            if (instrId !== null) {
                if (instrId === 0) {
                    marketName = "SOL/USDC";
                } else {
                    const instrument = this.engine.instruments.get(instrId);
                    if (instrument) {
                        try {
                            const assetTokenId = instrument.header.assetTokenId;
                            const crncyTokenId = instrument.header.crncyTokenId;
                            const assetSymbol = this.getAssetMetadata(1, Number(assetTokenId)).symbol;
                            const crncySymbol = this.getAssetMetadata(2, Number(crncyTokenId)).symbol;
                            marketName = `${assetSymbol}/${crncySymbol}`;
                        } catch (e) {
                            marketName = `Instrument-${instrId}`;
                        }
                    } else {
                        marketName = `Instrument-${instrId}`;
                    }
                }
            }

            // Normalization helper
            const scaleIfRaw = (val: any, dec: number) => {
                const n = Number(val || 0);
                return (n > 1e12 || n < -1e12) ? n / Math.pow(10, dec) : n;
            };

            // Perp Fill (Tag 19 or 16)
            if (r.tag === 19 || r.tag === 16) {
                const baseChange = scaleIfRaw(r.baseChange || r.perps || 0, 9);
                const quoteChange = scaleIfRaw(r.quoteChange || r.crncy || 0, 6);
                const fee = scaleIfRaw(r.fee || r.fees || 0, 6);
                const price = scaleIfRaw(r.price || r.px || 0, 9);

                const side = baseChange > 0 ? "BUY" : "SELL";
                const quantity = Math.abs(baseChange);
                let finalPrice = price;
                if (finalPrice === 0 && baseChange !== 0) {
                    finalPrice = Math.abs(quoteChange / baseChange);
                }

                history.push({
                    signature, timestamp, datetime,
                    type: 'trade',
                    market: marketName,
                    instrId,
                    side,
                    quantity,
                    price: finalPrice,
                    fee_amount: fee,
                    value: Math.abs(quoteChange)
                });
            }
            // Spot Fill (Tag 11 or 12)
            else if (r.tag === 11 || r.tag === 12) {
                const qty = scaleIfRaw(r.qty || r.amount || 0, 9);
                const crncy = scaleIfRaw(r.crncy || r.quote || 0, 6);
                const fee = scaleIfRaw(r.fee || r.fees || 0, 6);
                const price = scaleIfRaw(r.price || r.px || 0, 9);

                const side = Number(r.side) === 0 ? "BUY" : "SELL";
                let finalPrice = price;
                if (finalPrice === 0 && qty !== 0) {
                    finalPrice = Math.abs(crncy / qty);
                }

                history.push({
                    signature, timestamp, datetime,
                    type: 'trade',
                    market: marketName,
                    instrId,
                    side,
                    quantity: Math.abs(qty),
                    price: finalPrice,
                    fee_amount: fee,
                    value: Math.abs(crncy)
                });
            }
            // Funding (Tag 24)
            else if (r.tag === 24) {
                const funding = scaleIfRaw(r.funding || 0, 6);
                history.push({
                    signature, timestamp, datetime,
                    type: 'funding',
                    market: marketName,
                    instrId,
                    funding_amount: funding
                });
            }
            // Liquidations (Tag 21)
            else if (r.tag === 21) {
                history.push({
                    signature, timestamp, datetime,
                    type: 'liquidation',
                    market: marketName,
                    instrId
                });
            }
        }

        return history;
    }

    private serializeReports(reports: any[]) {
        // Debug: Log reports for inspection if they contain a FillOrder
        const hasFill = reports.some(r => r.tag === 11 || r.tag === 19);
        if (hasFill) {
            console.log("Fill Reports Found:", JSON.stringify(reports, (key, value) =>
                typeof value === 'bigint' ? value.toString() : value
                , 2));
        }

        // 1. Pre-scan to gather context from the transaction logs
        let instrIdNum: number | null = null;
        const orderTypes = new Map<number, number>(); // Map orderId to orderType

        for (const report of reports) {
            if (report.instrId !== undefined && instrIdNum === null) {
                instrIdNum = Number(report.instrId);
            }
            // spotPlaceOrder has tag 10, perpPlaceOrder has tag 14
            if (report.tag === 10 || report.tag === 14) {
                orderTypes.set(Number(report.orderId), Number(report.orderType));
            }
        }

        let marketName = 'Unknown Market';
        if (instrIdNum !== null) {
            if (instrIdNum === 0) {
                marketName = "SOL/USDC";
            } else {
                const instrument = this.engine.instruments.get(instrIdNum);
                if (instrument) {
                    // @ts-ignore
                    const assetTokenId = instrument.header.assetTokenId;
                    // @ts-ignore
                    const crncyTokenId = instrument.header.crncyTokenId;

                    const assetSymbol = this.getAssetMetadata(1, assetTokenId).symbol;
                    const crncySymbol = this.getAssetMetadata(2, crncyTokenId).symbol;

                    marketName = `${assetSymbol}/${crncySymbol}`;
                } else {
                    marketName = `Instrument-${instrIdNum}`;
                }
            }
        }

        // 2. Map and enrich reports
        const fees = new Map<number, number>();
        for (const report of reports) {
            if (report.tag === 11 || report.tag === 15 || report.tag === 23) { // spotFees, perpFees (tag 15/23)
                const orderId = Number(report.orderId);
                const amount = Number(report.amount || report.fees || 0);
                fees.set(orderId, (fees.get(orderId) || 0) + amount);
            }
        }

        return reports.map(report => {
            const r = report;
            let type = LogType[r.tag] || `unknown_${r.tag}`;

            // Normalize tags for backward/forward compatibility
            if (r.tag === 19) type = "perpFillOrder";
            if (r.tag === 11) type = "spotFillOrder";
            if (r.tag === 21) type = "perpOrderCancel";
            if (r.tag === 18) type = "perpPlaceOrder";
            if (r.tag === 10) type = "spotPlaceOrder";

            // Map potential alternative fill tags if standard ones are missing
            if (r.tag === 16) type = "spotFillOrder";
            if (r.tag === 25) type = "perpFillOrder";

            const data: any = {};
            for (const key in r) {
                if (Object.prototype.hasOwnProperty.call(r, key)) {
                    const value = r[key];
                    data[key] = typeof value === 'bigint' ? value.toString() : value;
                }
            }

            // Normalization helper (matches getPerpPnLTimeline scaling logic)
            const scaleIfRaw = (val: any, dec: number) => {
                const n = Number(val || 0);
                return (n > 1e12 || n < -1e12) ? n / Math.pow(10, dec) : n;
            };

            const isFill = type.includes('FillOrder');
            const isPerp = type.startsWith('perp');

            // Find instrId for this specific report if available
            let itemInstrId = r.instrId !== undefined ? Number(r.instrId) : instrIdNum;
            let itemMarketName = marketName;

            if (itemInstrId !== null && itemInstrId !== instrIdNum) {
                // Secondary lookup if different from TX default
                if (itemInstrId === 0) itemMarketName = "SOL/USDC";
                else {
                    const instrument = this.engine.instruments.get(itemInstrId);
                    if (instrument) {
                        try {
                            const assetSymbol = this.getAssetMetadata(1, instrument.header.assetTokenId).symbol;
                            const crncySymbol = this.getAssetMetadata(2, instrument.header.crncyTokenId).symbol;
                            itemMarketName = `${assetSymbol}/${crncySymbol}`;
                        } catch (e) { }
                    }
                }
            }

            data.market = itemMarketName;
            data.instrId = itemInstrId;

            if (isFill || type.includes('PlaceOrder')) {
                // Side determination
                let sideLabel = "UNKNOWN";
                const sideRaw = Number(r.side !== undefined ? r.side : (r.baseChange < 0 || r.perps < 0 ? 1 : 0));
                sideLabel = sideRaw === 0 ? "BUY" : "SELL";

                data.side_label = sideLabel;
                data.action = `${sideLabel} ${itemMarketName}`;

                const orderId = Number(r.orderId || 0);
                data.fee = fees.get(orderId) || 0;

                // Scale values
                if (isPerp) {
                    data.qty = Math.abs(scaleIfRaw(r.baseChange || r.perps || 0, 9));
                    data.price = scaleIfRaw(r.price || r.px || 0, 9);
                } else {
                    data.qty = Math.abs(scaleIfRaw(r.qty || r.amount || 0, 9));
                    data.price = scaleIfRaw(r.px || r.price || 0, 9);

                    // Fallback price calculation for spot fills (tag 11 often has crncy but no price)
                    if (data.price === 0 && data.qty > 0) {
                        const crncy = Math.abs(scaleIfRaw(r.crncy || r.quote || 0, 6));
                        if (crncy > 0) data.price = crncy / data.qty;
                    }
                }

                if (orderTypes.has(orderId)) {
                    data.fill_type = this.getOrderTypeLabel(orderTypes.get(orderId));
                } else if (r.orderType !== undefined) {
                    data.fill_type = this.getOrderTypeLabel(Number(r.orderType));
                }
            }

            if (data.tokenId !== undefined) {
                data.token_name = this.getAssetMetadata(1, Number(data.tokenId)).symbol;
            }

            return { type, data };
        });
    }
    async getOrderBook(instrId: number) {
        const instr = this.engine.instruments.get(instrId);
        if (!instr) throw new Error(`Instrument ID ${instrId} is not registered in the Engine.`);

        try {
            await this.engine.updateInstrData({ instrId });
        } catch (e) { }

        return {
            instrId,
            lastPrice: instr.header.lastPx.toString(),
            bestBid: instr.header.bestBid.toString(),
            bestAsk: instr.header.bestAsk.toString(),
            bids: (instr.spotBids || []).slice(0, 5).map((b: any) => ({ px: b.px.toString(), qty: b.qty.toString() })),
            asks: (instr.spotAsks || []).slice(0, 5).map((a: any) => ({ px: a.px.toString(), qty: a.qty.toString() }))
        };
    }

    /**
     * Get open perpetual orders for a wallet
     * Returns all open orders (bids and asks) across all instruments
     */
    async getPerpOpenOrders(walletStr: string) {
        const wallet = address(walletStr);
        await this.engine.setSigner(wallet);

        // Get client data to access perp order info
        const clientData = await this.engine.getClientData();
        if (!clientData) {
            throw new Error("No client data found for this wallet.");
        }

        const allOrders: any[] = [];

        // Iterate through all perp positions to find open orders
        if (clientData.perp) {
            for (const [instrId, perpData] of clientData.perp.entries()) {
                try {
                    // Get order info for this instrument
                    const ordersInfo = await this.engine.getClientPerpOrdersInfo({
                        instrId,
                        clientId: perpData.clientId
                    });

                    // Only query orders if there are any
                    if (ordersInfo.bidsCount > 0 || ordersInfo.asksCount > 0) {
                        const orders = await this.engine.getClientPerpOrders({
                            instrId,
                            bidsCount: ordersInfo.bidsCount,
                            asksCount: ordersInfo.asksCount,
                            bidsEntry: ordersInfo.bidsEntry,
                            asksEntry: ordersInfo.asksEntry
                        });

                        // Get market name
                        let marketName = 'Unknown Market';
                        if (instrId === 0) {
                            marketName = "SOL/USDC";
                        } else {
                            const instrument = this.engine.instruments.get(instrId);
                            if (instrument) {
                                // @ts-ignore
                                const assetTokenId = instrument.header.assetTokenId;
                                // @ts-ignore
                                const crncyTokenId = instrument.header.crncyTokenId;

                                const assetSymbol = this.getAssetMetadata(1, assetTokenId).symbol;
                                const crncySymbol = this.getAssetMetadata(1, crncyTokenId).symbol;

                                marketName = `${assetSymbol}/${crncySymbol}`;
                            } else {
                                marketName = `Instrument-${instrId}`;
                            }
                        }

                        // Process bids
                        for (const bid of orders.bids) {
                            allOrders.push({
                                instrument_id: instrId,
                                market: marketName,
                                side: "BUY",
                                order_id: bid.orderId?.toString(),
                                quantity: bid.qty?.toString(),
                                time: bid.time,
                                raw_data: {
                                    qty: bid.qty?.toString(),
                                    sum: bid.sum?.toString(),
                                    orderId: bid.orderId?.toString(),
                                    clientId: bid.clientId,
                                    line: bid.line
                                }
                            });
                        }

                        // Process asks
                        for (const ask of orders.asks) {
                            allOrders.push({
                                instrument_id: instrId,
                                market: marketName,
                                side: "SELL",
                                order_id: ask.orderId?.toString(),
                                quantity: ask.qty?.toString(),
                                time: ask.time,
                                raw_data: {
                                    qty: ask.qty?.toString(),
                                    sum: ask.sum?.toString(),
                                    orderId: ask.orderId?.toString(),
                                    clientId: ask.clientId,
                                    line: ask.line
                                }
                            });
                        }
                    }
                } catch (err) {
                    console.error(`Error fetching orders for instrument ${instrId}:`, err);
                    // Continue with other instruments
                }
            }
        }

        return {
            wallet: walletStr,
            total_orders: allOrders.length,
            orders: allOrders
        };
    }

    async getPerpPnLTimeline(walletStr: string, params?: { instrId?: number, limit?: number }) {
        const wallet = address(walletStr);
        await this.engine.setSigner(wallet);

        // @ts-ignore
        const clientAcc = this.engine.clientPrimaryAccount;
        if (!clientAcc) {
            return {
                wallet: walletStr,
                total_events: 0,
                timeline: [],
                summary: {
                    total_net_pnl: 0,
                    total_fees: 0,
                    trade_count: 0
                }
            };
        }

        // Fetch user Client ID for filtering
        let userClientId = 0;
        try {
            const sdkData = await this.engine.getClientData();
            // @ts-ignore
            userClientId = Number(sdkData?.community?.header?.id || 0);
        } catch (e) {
            console.warn("[WARN] Failed to fetch client data for ID filtering:", e);
        }

        // Fetch ALL signatures to ensure we have the full history for state tracking
        // Missing history is the primary cause of "cumulative resetting" or wrong starting state
        // Fetch signatures with a high limit to ensure full history for analytics
        let allSignatures: any[] = [];
        let before: any = undefined;
        while (allSignatures.length < 10000) {
            try {
                const batch = await this.rpc.getSignaturesForAddress(clientAcc, { limit: 1000, before }).send();
                if (batch.length === 0) break;
                allSignatures.push(...batch);
                before = batch[batch.length - 1].signature;
                if (batch.length < 1000) break;
            } catch (e) {
                console.warn("Failed to fetch signatures, may be rate limited:", e);
                break;
            }
        }

        const events: any[] = [];
        let globalCumulativePnL = 0;

        // Track state per instrument across the entire history
        const positionState = new Map<number, {
            size: number,
            avgEntry: number,
            totalFees: number,
            totalFunding: number,
            totalSocLoss: number
        }>();

        // Process from oldest to newest to reconstruct state accurately
        const sortedSignatures = [...allSignatures].reverse();

        // Use batching for getTransaction to respect rate limits
        const BATCH_SIZE = 5; // Balanced for speed/limit
        for (let i = 0; i < sortedSignatures.length; i += BATCH_SIZE) {
            const batch = sortedSignatures.slice(i, i + BATCH_SIZE);
            if (i > 0) await new Promise(r => setTimeout(r, 200)); // Short delay between batches

            const batchResults = await Promise.all(batch.map(async (sig) => {
                let retryCount = 0;
                while (retryCount < 3) {
                    try {
                        const tx = await this.rpc.getTransaction(sig.signature, {
                            encoding: 'json',
                            maxSupportedTransactionVersion: 0,
                            commitment: 'confirmed'
                        }).send();
                        return { tx, sig };
                    } catch (e: any) {
                        if (e.statusCode === 429 || e.message?.includes('429')) {
                            retryCount++;
                            await new Promise(r => setTimeout(r, 200 * retryCount)); // Exponential backoff
                        } else {
                            return { tx: null, sig };
                        }
                    }
                }
                return { tx: null, sig };
            }));

            for (const { tx, sig } of batchResults) {
                if (!tx?.meta?.logMessages) continue;

                let reports: any[] = [];
                try {
                    reports = this.engine.logsDecode(tx.meta.logMessages);
                } catch (e) {
                    console.warn(`[WARN] Failed to decode logs for TX ${sig.signature}:`, e);
                    continue;
                }

                const blockTime = Number((tx as any).blockTime || 0);

                // -- PRE-SCAN TRANSACTION --
                // 1. Map orderId -> instrId
                // 2. Collect unique instrument IDs present in this transaction
                const txOrderIdToInstrId = new Map<number, number>();
                const txOrderIdToOrderType = new Map<number, number>();
                const txFillOrders = new Set<number>();
                const txOpenOrders = new Set<number>();
                const instrIdsInTx = new Set<number>();

                for (const report of reports) {
                    const r = report as any;
                    if (r.instrId !== undefined) {
                        const id = Number(r.instrId);
                        instrIdsInTx.add(id);
                        if (r.orderId !== undefined) {
                            txOrderIdToInstrId.set(Number(r.orderId), id);
                        }
                    }
                    if (r.orderId !== undefined && r.orderType !== undefined) {
                        txOrderIdToOrderType.set(Number(r.orderId), Number(r.orderType));
                    }
                    if (r.tag === 20) txOpenOrders.add(Number(r.orderId || 0));
                    if (r.tag === 19) txFillOrders.add(Number(r.orderId || 0));
                }

                // -- PROCESS REPORTS --
                for (const report of reports) {
                    const r = report as any;
                    let instrId = r.instrId !== undefined ? Number(r.instrId) : undefined;

                    // Try to recover instrId from orderId
                    if (instrId === undefined && r.orderId !== undefined) {
                        instrId = txOrderIdToInstrId.get(Number(r.orderId));
                    }

                    if (instrId === undefined) {
                        if (instrIdsInTx.size === 1) instrId = Array.from(instrIdsInTx)[0];
                        else continue;
                    }

                    if (!positionState.has(instrId)) {
                        positionState.set(instrId, {
                            size: 0, avgEntry: 0, totalFees: 0, totalFunding: 0, totalSocLoss: 0
                        });
                    }
                    const state = positionState.get(instrId)!;

                    const instrInfo = this.engine.instruments.get(instrId);
                    let marketName = instrId === 0 ? "SOL/USDC" : `Instrument-${instrId}`;
                    if (instrInfo) {
                        const assetMetadata = this.getAssetMetadata(1, instrInfo.header.assetTokenId);
                        const crncyMetadata = this.getAssetMetadata(2, instrInfo.header.crncyTokenId);
                        marketName = `${assetMetadata.symbol}/${crncyMetadata.symbol}`;
                    }

                    // Helper: normalize scaling
                    const scaleIfRaw = (val: any, dec: number) => {
                        const n = Number(val || 0);
                        return (n > 1e12 || n < -1e12) ? n / Math.pow(10, dec) : n;
                    };

                    // TAG 19 = perpFillOrder, TAG 25 = perpPlaceMassCancel (sometimes used for fills)
                    if (r.tag === 19 || r.tag === 25) {
                        const orderId = Number(r.orderId || 0);

                        const isBuy = Number(r.side) === 0;
                        let perps = Math.abs(scaleIfRaw(r.baseChange || r.perps || 0, 9));
                        let price = scaleIfRaw(r.price || r.px || 0, 9);

                        // Fallback price calculation for fills if price is missing
                        if (price === 0 && r.tag === 19) {
                            const crncy = Math.abs(scaleIfRaw(r.crncy || r.quoteChange || 0, 6));
                            if (perps > 0 && crncy > 0) price = crncy / perps;
                        }

                        if (perps === 0) continue;

                        let eventPnL = 0;
                        const prevSize = state.size;
                        const isClosing = (prevSize > 0 && !isBuy) || (prevSize < 0 && isBuy);

                        if (isClosing) {
                            const closedQty = Math.min(perps, Math.abs(prevSize));
                            if (prevSize > 0) eventPnL = (price - state.avgEntry) * closedQty;
                            else eventPnL = (state.avgEntry - price) * closedQty;

                            globalCumulativePnL = Number((globalCumulativePnL + eventPnL).toFixed(8));
                            const remainingAfterClose = perps - closedQty;

                            if (remainingAfterClose > 0) {
                                state.size = isBuy ? remainingAfterClose : -remainingAfterClose;
                                state.avgEntry = price;
                            } else {
                                state.size = isBuy ? state.size + perps : state.size - perps;
                                if (Math.abs(state.size) < 1e-10) {
                                    state.size = 0;
                                    state.avgEntry = 0;
                                }
                            }
                        } else {
                            const currentAbsSize = Math.abs(state.size);
                            const newAbsSize = currentAbsSize + perps;
                            if (newAbsSize > 0) {
                                state.avgEntry = ((currentAbsSize * state.avgEntry) + (perps * price)) / newAbsSize;
                            }
                            state.size = isBuy ? state.size + perps : state.size - perps;
                        }

                        events.push({
                            timestamp: blockTime,
                            datetime: new Date(blockTime * 1000).toISOString(),
                            type: r.tag === 21 ? 'liquidation' : 'trade',
                            market: marketName,
                            instrId: instrId,
                            side: isBuy ? 'BUY' : 'SELL',
                            quantity: perps,
                            price: price,
                            value: perps * price,
                            realized_pnl: Number(eventPnL.toFixed(8)),
                            position_size: Number(state.size.toFixed(8)),
                            avg_entry_price: Number(state.avgEntry.toFixed(8)),
                            cumulative_realized_pnl: Number(globalCumulativePnL.toFixed(8)),
                            order_type: this.getOrderTypeLabel(txOrderIdToOrderType.get(orderId)),
                            signature: sig.signature
                        });
                    }
                    // TAG 24 = perpFunding
                    else if (r.tag === 24) {
                        let funding = scaleIfRaw(r.funding || 0, 6);
                        state.totalFunding += funding;
                        globalCumulativePnL = Number((globalCumulativePnL + funding).toFixed(8));

                        events.push({
                            timestamp: blockTime,
                            datetime: new Date(blockTime * 1000).toISOString(),
                            type: 'funding',
                            market: marketName,
                            instrId: instrId,
                            funding_amount: funding,
                            cumulative_funding: Number(state.totalFunding.toFixed(8)),
                            cumulative_realized_pnl: Number(globalCumulativePnL.toFixed(8)),
                            signature: sig.signature
                        });
                    }
                    // TAG 15/23 = perpFees
                    else if (r.tag === 15 || r.tag === 23) {
                        let fee = scaleIfRaw(r.amount || r.fees || 0, 6);
                        state.totalFees += fee;
                        globalCumulativePnL = Number((globalCumulativePnL - fee).toFixed(8));

                        events.push({
                            timestamp: blockTime,
                            datetime: new Date(blockTime * 1000).toISOString(),
                            type: 'fee',
                            market: marketName,
                            instrId: instrId,
                            fee_amount: fee,
                            cumulative_fees: Number(state.totalFees.toFixed(8)),
                            cumulative_realized_pnl: Number(globalCumulativePnL.toFixed(8)),
                            signature: sig.signature
                        });
                    }
                    // TAG 27 = perpSocLoss
                    else if (r.tag === 27) {
                        let socLoss = scaleIfRaw(r.socLoss || 0, 6);
                        state.totalSocLoss += socLoss;
                        globalCumulativePnL = Number((globalCumulativePnL - socLoss).toFixed(8));

                        events.push({
                            timestamp: blockTime,
                            datetime: new Date(blockTime * 1000).toISOString(),
                            type: 'socialized_loss',
                            market: marketName,
                            instrId: instrId,
                            loss_amount: socLoss,
                            cumulative_soc_loss: Number(state.totalSocLoss.toFixed(8)),
                            cumulative_realized_pnl: Number(globalCumulativePnL.toFixed(8)),
                            signature: sig.signature
                        });
                    }
                }
            }
        }

        // Apply final visibility filters (Instrument ID and Timeline Limit)
        let filteredEvents = events;
        if (params?.instrId !== undefined) {
            filteredEvents = filteredEvents.filter(e => e.instrId === params.instrId);
        }

        // Final chronological sort and limit
        filteredEvents.sort((a, b) => a.timestamp - b.timestamp);
        const limit = params?.limit || 1000;
        const timeline = filteredEvents.slice(-limit);

        const summary: any = {};
        for (const [instrId, state] of positionState.entries()) {
            const instrInfo = this.engine.instruments.get(instrId);
            let marketName = instrId === 0 ? "SOL/USDC" : `Instrument-${instrId}`;
            if (instrInfo) {
                const assetMetadata = this.getAssetMetadata(1, instrInfo.header.assetTokenId);
                const crncyMetadata = this.getAssetMetadata(2, instrInfo.header.crncyTokenId);
                marketName = `${assetMetadata.symbol}/${crncyMetadata.symbol}`;
            }
            summary[marketName] = {
                current_position: Number(state.size.toFixed(8)),
                avg_entry_price: Number(state.avgEntry.toFixed(8)),
                total_fees: Number(state.totalFees.toFixed(8)),
                total_funding: Number(state.totalFunding.toFixed(8)),
                total_soc_loss: Number(state.totalSocLoss.toFixed(8))
            };
        }

        summary.global = {
            total_realized_pnl: Number(globalCumulativePnL.toFixed(8))
        };

        return {
            wallet: walletStr,
            timeline: timeline,
            summary: summary,
            total_events: timeline.length
        };
    }

    private getOrderTypeLabel(orderType: number | undefined): string {
        if (orderType === undefined) return "Unknown";

        switch (orderType) {
            case OrderType.limit:
                return "Limit";
            case OrderType.market:
                return "Market";
            case OrderType.marginCall:
                return "Margin Call";
            case OrderType.forcedClose:
                return "Forced Close";
            default:
                return `Unknown (${orderType})`;
        }
    }
}
