import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { DeriverseService } from './services/deriverse.service.js';

// Global BigInt Serializer
(BigInt.prototype as any).toJSON = function () {
    return this.toString();
};

const app = express();
const port = 8080;
const deriverse = new DeriverseService();
let isReady = false;

// Simple mutex for engine access
let engineMutex = Promise.resolve();
async function withEngineLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = engineMutex;
    let resolve: () => void;
    engineMutex = new Promise(r => resolve = r);
    await prev;
    try {
        return await fn();
    } finally {
        resolve!();
    }
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.disable('etag');

const swaggerSpec = {
    openapi: '3.0.0',
    info: {
        title: 'Deriverse Analytics Engine',
        version: '1.9.0',
        description: 'Direct Analytics for Deriverse v12 (PnL, Volume, Fees, Open Orders)',
    },
    servers: [{ url: `http://localhost:${port}` }],
    paths: {
        '/health': {
            get: {
                summary: 'Check engine status',
                responses: { '200': { description: 'OK' } }
            }
        },
        '/markets/list': {
            get: {
                summary: 'List available instruments (SOL/USDC, etc)',
                responses: { '200': { description: 'List of pairs' } }
            }
        },
        '/accounts/{wallet}': {
            get: {
                summary: 'Get Detailed Balances',
                parameters: [{
                    name: 'wallet',
                    in: 'path',
                    required: true,
                    schema: { type: 'string' }
                }],
                responses: { '200': { description: 'Success' } }
            }
        },
        '/trades/{wallet}': {
            get: {
                summary: 'Get Trade/Fill History (Raw Logs)',
                description: 'Returns enriched logs with fee and instrument mapping.',
                parameters: [{
                    name: 'wallet',
                    in: 'path',
                    required: true,
                    schema: { type: 'string' }
                }],
                responses: { '200': { description: 'Success' } }
            }
        },
        '/perp/openorders/{wallet}': {
            get: {
                summary: 'Get Open Perpetual Orders',
                description: 'Returns all open perpetual orders (bids and asks) across all instruments for a wallet',
                parameters: [{
                    name: 'wallet',
                    in: 'path',
                    required: true,
                    schema: { type: 'string' }
                }],
                responses: { '200': { description: 'Success' } }
            }
        },
        '/perp/pnl-timeline/{wallet}': {
            get: {
                summary: 'Get Perpetual PnL Timeline',
                description: 'Returns complete PnL history with trades, funding payments, fees, and socialized losses',
                parameters: [
                    {
                        name: 'wallet',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    },
                    {
                        name: 'instrId',
                        in: 'query',
                        required: false,
                        schema: { type: 'integer' },
                        description: 'Filter by instrument ID'
                    },
                    {
                        name: 'limit',
                        in: 'query',
                        required: false,
                        schema: { type: 'integer', default: 1000 },
                        description: 'Maximum number of transactions to fetch'
                    }
                ],
                responses: { '200': { description: 'Success' } }
            }
        },
        '/markets/{id}/orderbook': {
            get: {
                summary: 'Get Live Orderbook Depth',
                parameters: [{
                    name: 'id',
                    in: 'path',
                    required: true,
                    schema: { type: 'integer' }
                }],
                responses: { '200': { description: 'Success' } }
            }
        }
    }
};

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/', (req, res) => res.redirect('/docs'));

const checkReady = (req: any, res: any, next: any) => {
    if (!isReady) return res.status(503).json({ error: "System initializing..." });
    next();
};

app.get('/health', (req, res) => res.json({ status: "ok", initialized: isReady }));

app.get('/markets/list', checkReady, async (req, res) => {
    try {
        const list = await deriverse.getInstrumentsList();
        res.json(list);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/accounts/:wallet', checkReady, async (req, res) => {
    try {
        const data = await withEngineLock(() => deriverse.getAccountData(req.params.wallet));
        console.log(`\n--- TERMINAL MIRROR: Balances for ${req.params.wallet} ---`);
        console.log(JSON.stringify(data, null, 2));
        res.json(data);
    } catch (err: any) {
        console.error("Balance error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/trades/:wallet', checkReady, async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 5000;
        const trades = await withEngineLock(() => deriverse.getHistoricalLogs(req.params.wallet, limit));
        console.log(`\n--- TERMINAL MIRROR: ${trades.length} Transactions found ---`);
        if (trades.length > 0) {
            console.log("Full JSON Sample (First Trade):");
            console.log(JSON.stringify(trades[0], null, 2));
        }
        res.json(trades);
    } catch (err: any) {
        console.error("Trades error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/perp/openorders/:wallet', checkReady, async (req, res) => {
    try {
        const openOrders = await withEngineLock(() => deriverse.getPerpOpenOrders(req.params.wallet));
        console.log(`\n--- OPEN PERP ORDERS: ${openOrders.total_orders} orders found for ${req.params.wallet} ---`);
        if (openOrders.orders.length > 0) {
            console.log("Sample Order:");
            console.log(JSON.stringify(openOrders.orders[0], null, 2));
        }
        res.json(openOrders);
    } catch (err: any) {
        console.error("Open orders error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/perp/pnl-timeline/:wallet', checkReady, async (req, res) => {
    try {
        const instrId = req.query.instrId ? parseInt(req.query.instrId as string) : undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

        const pnlData = await withEngineLock(() => deriverse.getPerpPnLTimeline(req.params.wallet, { instrId, limit }));
        console.log(`\n--- PERP PNL TIMELINE: ${pnlData.total_events} events for ${req.params.wallet} ---`);
        res.json(pnlData);
    } catch (err: any) {
        console.error("PnL timeline error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/markets/:id/orderbook', checkReady, async (req, res) => {
    try {
        const data = await deriverse.getOrderBook(parseInt(req.params.id));
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

async function bootstrap() {
    console.log("Initializing Deriverse Engine...");

    let retries = 0;
    const maxRetries = 10;

    while (retries < maxRetries) {
        try {
            await deriverse.initialize();
            isReady = true;
            console.log("🚀 ENGINE READY");

            const server = app.listen(port, '0.0.0', () => {
                console.log(`\n🚀 API v1.9.0 READY ON PORT ${port}`);
                console.log(`🔗 Swagger UI: http://localhost:${port}/docs`);
            });

            process.on('SIGINT', () => {
                console.log('SIGINT signal received: closing HTTP server');
                server.close(() => {
                    console.log('HTTP server closed');
                    process.exit(0);
                });
            });

            return; // Success
        } catch (e) {
            retries++;
            console.error(`BOOTSTRAP ERROR (Attempt ${retries}/${maxRetries}):`, e);
            if (retries >= maxRetries) {
                console.error("CRITICAL BOOTSTRAP FAILURE: Max retries reached.");
                process.exit(1);
            }
            console.log("Retrying in 5 seconds...");
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

bootstrap();
