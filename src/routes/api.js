// src/routes/api.js
const express = require('express');
const router = express.Router();
const { handleMessage } = require('../services/conversation');
const { callClaude } = require('../services/claude');
const db = require('../db');

router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

router.use(express.json());

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
router.post('/message', async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message?.trim()) {
    return res.status(400).json({ error: 'userId and message are required' });
  }
  try {
    const reply = await handleMessage(userId, message.trim());
    const user = await db.getUserByPhone(userId);
    let state = null, traits = [];
    if (user) {
      state = await db.getProgramState(user.id);
      traits = await db.getSDTraits(user.id);
    }
    res.json({
      reply,
      state: state ? {
        sessionNumber: state.session_number,
        phase: state.phase,
        reportReady: state.report_ready,
      } : null,
      traits: traits.map(t => ({
        category: t.category,
        trait: t.trait,
        score: parseFloat(t.score),
        status: t.status,
        note: t.notes,
      })),
    });
  } catch(err) {
    console.error('API error:', err);
    res.status(500).json({ error: 'Something went wrong', detail: err.message });
  }
});

// ─── HARLOW FRONTEND ──────────────────────────────────────────────────────────
router.post('/harlow', async (req, res) => {
  const { messages, maxTokens, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }
  try {
    const text = await callClaude({
      system: system || '',
      messages,
      maxTokens: maxTokens || 1200,
    });
    res.json({ content: [{ type: 'text', text }] });
  } catch(err) {
    console.error('Harlow error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET STATE ────────────────────────────────────────────────────────────────
router.get('/state/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await db.getUserByPhone(userId);
    if (!user) return res.json({ exists: false });
    const state = await db.getProgramState(user.id);
    const traits = await db.getSDTraits(user.id);
    const milestones = await db.getMilestones(user.id);
    res.json({
      exists: true,
      user: { name: user.name, path: user.path, status: user.status },
      state: { sessionNumber: state.session_number, phase: state.phase, reportReady: state.report_ready },
      traits: traits.map(t => ({ category: t.category, trait: t.trait, score: parseFloat(t.score), status: t.status, note: t.notes })),
      milestones: milestones.map(m => ({ type: m.milestone_type, content: m.content, deliveredAt: m.delivered_at })),
    });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GOOGLE AUTH ──────────────────────────────────────────────────────────────
router.post('/auth/google', async (req, res) => {
  const { googleId, name, email } = req.body;
  if (!googleId) return res.status(400).json({ error: 'googleId required' });
  try {
    const userId = 'google_' + googleId;
    let user = await db.getUserByPhone(userId);
    if (!user) {
      user = await db.createUser(userId);
      await db.updateUser(user.id, { name: name || 'Friend', status: 'active' });
    }
    res.json({ ok: true, userId, name: user.name });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── RESET (testing) ──────────────────────────────────────────────────────────
router.post('/reset', async (req, res) => {
  const { userId, adminKey } = req.body;
  if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
  try {
    const user = await db.getUserByPhone(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await db.query('DELETE FROM sd_trait_scores WHERE user_id = $1', [user.id]);
    await db.query('DELETE FROM messages WHERE user_id = $1', [user.id]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    await db.query('DELETE FROM milestones WHERE user_id = $1', [user.id]);
    await db.query(`UPDATE program_state SET session_number=0, phase=1, last_session_summary=null,
      sessions_since_obs=0, observations_delivered=0, report_ready=false WHERE user_id=$1`, [user.id]);
    await db.query(`UPDATE users SET status='onboarding', name=null WHERE id=$1`, [user.id]);
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
