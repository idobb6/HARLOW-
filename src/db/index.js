// src/db/index.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB error:', err.message);
});

const db = {
  query: (text, params) => pool.query(text, params),

  // ─── USERS ─────────────────────────────────────────────────────
  async getUserByPhone(phone) {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE phone_number = $1', [phone]
    );
    return rows[0] || null;
  },

  async createUser(phone) {
    const { rows } = await pool.query(
      `INSERT INTO users (phone_number) VALUES ($1)
       ON CONFLICT (phone_number) DO UPDATE SET updated_at = NOW()
       RETURNING *`, [phone]
    );
    // Create program_state row
    await pool.query(
      `INSERT INTO program_state (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [rows[0].id]
    );
    return rows[0];
  },

  async updateUser(id, fields) {
    const keys = Object.keys(fields);
    const vals = Object.values(fields);
    const sets = keys.map((k, i) => `${k} = $${i+2}`).join(', ');
    const { rows } = await pool.query(
      `UPDATE users SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...vals]
    );
    return rows[0];
  },

  // ─── SESSIONS ─────────────────────────────────────────────────
  async getOrCreateSession(userId, sessionNumber) {
    const { rows } = await pool.query(
      `SELECT * FROM sessions WHERE user_id = $1 AND session_number = $2`,
      [userId, sessionNumber]
    );
    if (rows[0]) return rows[0];
    const { rows: newRows } = await pool.query(
      `INSERT INTO sessions (user_id, session_number) VALUES ($1, $2) RETURNING *`,
      [userId, sessionNumber]
    );
    return newRows[0];
  },

  async getRecentSessions(userId, limit = 3) {
    const { rows } = await pool.query(
      `SELECT * FROM sessions WHERE user_id = $1
       ORDER BY session_number DESC LIMIT $2`,
      [userId, limit]
    );
    return rows;
  },

  async updateSession(id, fields) {
    const keys = Object.keys(fields);
    const vals = Object.values(fields);
    const sets = keys.map((k, i) => `${k} = $${i+2}`).join(', ');
    await pool.query(
      `UPDATE sessions SET ${sets} WHERE id = $1`, [id, ...vals]
    );
  },

  // ─── MESSAGES ─────────────────────────────────────────────────
  async saveMessage(sessionId, userId, role, content, signalTags = null) {
    const { rows } = await pool.query(
      `INSERT INTO messages (session_id, user_id, role, content, signal_tags)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [sessionId, userId, role, content, signalTags ? JSON.stringify(signalTags) : null]
    );
    return rows[0];
  },

  async getSessionMessages(sessionId) {
    const { rows } = await pool.query(
      `SELECT role, content FROM messages
       WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    );
    return rows;
  },

  // ─── TRAITS (Self-Discovery) ──────────────────────────────────
  async updateSDTrait(userId, category, trait, scoreDelta, note = null) {
    const { rows } = await pool.query(
      `INSERT INTO sd_trait_scores (user_id, category, trait, score, signal_count, notes)
       VALUES ($1, $2, $3, $4, 1, $5)
       ON CONFLICT (user_id, category, trait)
       DO UPDATE SET
         score        = sd_trait_scores.score + $4,
         signal_count = sd_trait_scores.signal_count + 1,
         notes        = COALESCE($5, sd_trait_scores.notes),
         status       = CASE
           WHEN sd_trait_scores.score + $4 >= 45 THEN 'confirmed'
           WHEN sd_trait_scores.score + $4 >= 25 THEN 'strong'
           WHEN sd_trait_scores.score + $4 >= 12 THEN 'developing'
           WHEN sd_trait_scores.score + $4 >= 5  THEN 'early'
           ELSE 'untested'
         END,
         last_updated = NOW()
       RETURNING *`,
      [userId, category, trait, scoreDelta, note]
    );
    return rows[0];
  },

  async getSDTraits(userId) {
    const { rows } = await pool.query(
      `SELECT * FROM sd_trait_scores WHERE user_id = $1 ORDER BY score DESC`,
      [userId]
    );
    return rows;
  },

  // ─── PROGRAM STATE ────────────────────────────────────────────
  async getProgramState(userId) {
    const { rows } = await pool.query(
      `SELECT * FROM program_state WHERE user_id = $1`, [userId]
    );
    if (!rows[0]) {
      await pool.query(`INSERT INTO program_state (user_id) VALUES ($1)`, [userId]);
      return this.getProgramState(userId);
    }
    return rows[0];
  },

  async updateProgramState(userId, fields) {
    const keys = Object.keys(fields);
    const vals = Object.values(fields);
    const sets = keys.map((k, i) => `${k} = $${i+2}`).join(', ');
    await pool.query(
      `UPDATE program_state SET ${sets}, updated_at = NOW() WHERE user_id = $1`,
      [userId, ...vals]
    );
  },

  // ─── MILESTONES ───────────────────────────────────────────────
  async saveMilestone(userId, sessionId, type, content, traitCodes = []) {
    const { rows } = await pool.query(
      `INSERT INTO milestones (user_id, session_id, milestone_type, content, trait_codes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, sessionId, type, content, traitCodes]
    );
    return rows[0];
  },

  async getMilestones(userId) {
    const { rows } = await pool.query(
      `SELECT * FROM milestones WHERE user_id = $1 ORDER BY delivered_at ASC`,
      [userId]
    );
    return rows;
  },
};

module.exports = db;
