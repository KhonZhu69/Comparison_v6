// src/client/js/api.js
// All communication with the Express backend.
// Replaces the old localStorage-based loadDatabase / saveDatabase pattern.

const BASE = '/api';

window.Api = {

  /** Fetch all saved results (newest first from server). */
  async getResults() {
    const res = await fetch(`${BASE}/results`);
    if (!res.ok) throw new Error(`GET /results → ${res.status}`);
    return res.json();
  },

  /** Save a new result object to the database. */
  async saveResult(result) {
    const res = await fetch(`${BASE}/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `POST /results → ${res.status}`);
    }
    return res.json();
  },

  /** Update an existing saved result in the database. */
  async updateResult(id, result) {
    const res = await fetch(`${BASE}/results/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `PUT /results/${id} → ${res.status}`);
    }
    return res.json();
  },

  /** Delete a single result by id. */
  async deleteResult(id) {
    const res = await fetch(`${BASE}/results/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE /results/${id} → ${res.status}`);
    return res.json();
  },

  /** Wipe every result from the database. */
  async clearAll() {
    const res = await fetch(`${BASE}/results`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE /results → ${res.status}`);
    return res.json();
  },

  /** Health check — used to show the DB status badge in the header. */
  async health() {
    const res = await fetch('/health');
    return res.json();
  },
};
