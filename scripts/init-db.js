// scripts/init-db.js
// Run once to create the table:  npm run db:init
// Render will run this automatically via the "Pre-Deploy Command" if you set it
// in render.yaml.  You can also trigger it manually from the Render shell.

import pool from '../src/server/db.js';

const SQL = `
  CREATE TABLE IF NOT EXISTS prompt_results (
    id             TEXT        PRIMARY KEY,
    prompt_number  INTEGER     NOT NULL,
    title          TEXT        NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    prompt         TEXT        NOT NULL,
    threshold      INTEGER     NOT NULL DEFAULT 60,
    metrics        JSONB       NOT NULL DEFAULT '{}',
    comparison     JSONB       NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS idx_prompt_results_created_at
    ON prompt_results (created_at);
`;

try {
  await pool.query(SQL);
  console.log('✅  Database initialised — table prompt_results ready.');
} catch (err) {
  console.error('❌  DB init failed:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
