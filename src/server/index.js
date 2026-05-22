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

// Auto-create table on startup — adds new columns if they don't exist yet
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prompt_results (
        id             TEXT        PRIMARY KEY,
        prompt_number  TEXT        NOT NULL,
        title          TEXT        NOT NULL DEFAULT '',
        paper_name     TEXT        NOT NULL DEFAULT '',
        model_name     TEXT        NOT NULL DEFAULT '',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        prompt         TEXT        NOT NULL,
        threshold      INTEGER     NOT NULL DEFAULT 60,
        metrics        JSONB       NOT NULL DEFAULT '{}',
        comparison     JSONB       NOT NULL DEFAULT '[]'
      );
      ALTER TABLE prompt_results ADD COLUMN IF NOT EXISTS paper_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE prompt_results ADD COLUMN IF NOT EXISTS model_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE prompt_results ALTER COLUMN prompt_number TYPE TEXT USING prompt_number::TEXT;
      CREATE INDEX IF NOT EXISTS idx_prompt_results_created_at ON prompt_results (created_at);
    `);
    console.log('✅  DB table ready.');
  } catch (err) {
    console.error('❌  DB init error:', err.message);
  }
}

await initDb();
app.listen(PORT, () => {
  console.log(`✅  Server running on http://localhost:${PORT}`);
  console.log(`   NODE_ENV : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   DB       : ${process.env.DATABASE_URL ? 'connected' : 'NOT SET'}`);
});