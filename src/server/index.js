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

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const CLIENT_DIR = join(__dirname, '../../src/client');
app.use(express.static(CLIENT_DIR));
app.use('/api/results', resultsRouter);

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', db: 'connected' }); }
  catch { res.status(503).json({ status: 'error', db: 'unreachable' }); }
});

app.get('*', (_req, res) => res.sendFile(join(CLIENT_DIR, 'index.html')));

// Run each migration separately so one failure doesn't block the rest
async function initDb() {
  const steps = [
    `CREATE TABLE IF NOT EXISTS prompt_results (
      id             TEXT        PRIMARY KEY,
      prompt_number  TEXT        NOT NULL DEFAULT '',
      title          TEXT        NOT NULL DEFAULT '',
      paper_name     TEXT        NOT NULL DEFAULT '',
      model_name     TEXT        NOT NULL DEFAULT '',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      prompt         TEXT        NOT NULL DEFAULT '',
      threshold      INTEGER     NOT NULL DEFAULT 60,
      metrics        JSONB       NOT NULL DEFAULT '{}',
      comparison     JSONB       NOT NULL DEFAULT '[]'
    )`,
    `ALTER TABLE prompt_results ADD COLUMN IF NOT EXISTS paper_name TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE prompt_results ADD COLUMN IF NOT EXISTS model_name TEXT NOT NULL DEFAULT ''`,
    `CREATE INDEX IF NOT EXISTS idx_prompt_results_created_at ON prompt_results (created_at)`,
  ];

  for (const sql of steps) {
    try { await pool.query(sql); }
    catch (err) { console.warn('DB migration warning:', err.message); }
  }
  console.log('✅  DB ready.');
}

await initDb();
app.listen(PORT, () => {
  console.log(`✅  Server running on http://localhost:${PORT}`);
  console.log(`   DB: ${process.env.DATABASE_URL ? 'URL set' : 'NOT SET'}`);
});