import express from 'express';
import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './src/config.js';
import { createApp } from './src/app.js';

// One client per warm function instance; Prisma connects lazily on first query.
// Never connect/disconnect per request. Local startup remains in src/server.js.
const config = loadConfig();
const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL, log: [] });
const app = express();
app.disable('x-powered-by');
app.use(createApp({ db, config, logger: pino({ level: 'info' }) }));
export default app;
