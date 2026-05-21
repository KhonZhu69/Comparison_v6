// src/server/index.js
// Express server — serves the static frontend and the /api REST layer.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import resultsRouter from './routes/results.js';
import pool from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));   // comparison payloads can be large

// ── Static frontend ───────────────────────────────────────────────────────────
// Render's web service will serve index.html + assets from src/client/
const CLIENT_DIR = join(__dirname, '../../src/client');
app.use(express.static(CLIENT_DIR));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/results', resultsRouter);

// ── Health check (used by Render) ─────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

// ── SPA fallback — serve index.html for any non-API route ────────────────────
app.get('*', (_req, res) => {
  res.sendFile(join(CLIENT_DIR, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Server running on http://localhost:${PORT}`);
  console.log(`   NODE_ENV  : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   DB        : ${process.env.DATABASE_URL ? 'connected' : 'NOT SET'}`);
});
