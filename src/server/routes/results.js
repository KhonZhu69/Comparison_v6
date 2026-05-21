// src/server/routes/results.js
// REST endpoints for saved prompt comparison results.
//
//  GET    /api/results        → list all results (newest first)
//  POST   /api/results        → create a new result
//  DELETE /api/results/:id    → delete one result
//  DELETE /api/results        → delete ALL results (clear database)

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// ── GET /api/results ──────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         id,
         prompt_number  AS "promptNumber",
         title,
         created_at     AS "createdAt",
         prompt,
         threshold,
         metrics,
         comparison
       FROM prompt_results
       ORDER BY prompt_number ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/results error:', err.message);
    res.status(500).json({ error: 'Failed to fetch results.' });
  }
});

// ── POST /api/results ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { id, promptNumber, title, prompt, threshold, metrics, comparison } = req.body;

  if (!id || !prompt || !metrics) {
    return res.status(400).json({ error: 'id, prompt, and metrics are required.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO prompt_results
         (id, prompt_number, title, prompt, threshold, metrics, comparison)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING
       RETURNING
         id,
         prompt_number  AS "promptNumber",
         title,
         created_at     AS "createdAt",
         prompt,
         threshold,
         metrics,
         comparison`,
      [id, promptNumber, title, prompt, threshold, JSON.stringify(metrics), JSON.stringify(comparison)]
    );

    if (!rows.length) {
      return res.status(409).json({ error: 'A result with this id already exists.' });
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /api/results error:', err.message);
    res.status(500).json({ error: 'Failed to save result.' });
  }
});

// ── DELETE /api/results/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM prompt_results WHERE id = $1',
      [req.params.id]
    );

    if (!rowCount) {
      return res.status(404).json({ error: 'Result not found.' });
    }

    // Re-number remaining results so promptNumber stays sequential
    await pool.query(`
      UPDATE prompt_results pr
      SET    prompt_number = sub.rn,
             title         = 'Prompt ' || sub.rn
      FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
        FROM   prompt_results
      ) sub
      WHERE pr.id = sub.id
    `);

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/results/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete result.' });
  }
});

// ── DELETE /api/results ───────────────────────────────────────────────────────
router.delete('/', async (_req, res) => {
  try {
    await pool.query('DELETE FROM prompt_results');
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/results error:', err.message);
    res.status(500).json({ error: 'Failed to clear database.' });
  }
});

export default router;
