// src/server/routes/results.js
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const resultFields = `id, prompt_number AS "promptNumber", title,
                 paper_name AS "paperName", model_name AS "modelName",
                 created_at AS "createdAt", prompt, threshold, metrics, comparison`;

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, prompt_number AS "promptNumber", title, paper_name AS "paperName",
              model_name AS "modelName", created_at AS "createdAt",
              prompt, threshold, metrics, comparison
       FROM prompt_results ORDER BY created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/results error:', err.message);
    res.status(500).json({ error: 'Failed to fetch results.' });
  }
});

router.post('/', async (req, res) => {
  const { id, promptNumber, title, paperName, modelName, prompt, threshold, metrics, comparison } = req.body;
  if (!id || !prompt || !metrics) {
    return res.status(400).json({ error: 'id, prompt, and metrics are required.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO prompt_results
         (id, prompt_number, title, paper_name, model_name, prompt, threshold, metrics, comparison)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING
       RETURNING ${resultFields}`,
      [id, promptNumber, title||`Prompt ${promptNumber}`, paperName||'', modelName||'',
       prompt, threshold, JSON.stringify(metrics), JSON.stringify(comparison)]
    );
    if (!rows.length) return res.status(409).json({ error: 'A result with this id already exists.' });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /api/results error:', err.message);
    res.status(500).json({ error: 'Failed to save result.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM prompt_results WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Result not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/results/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete result.' });
  }
});

router.delete('/', async (_req, res) => {
  try {
    await pool.query('DELETE FROM prompt_results');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear database.' });
  }
});

export default router;
