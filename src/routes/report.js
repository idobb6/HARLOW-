// src/routes/report.js
// Dedicated report generation endpoint — separate from conversation API
// Uses longer timeout and higher token budget

const express = require('express');
const router = express.Router();

router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

router.use(express.json());

const REPORT_SYSTEM_PROMPT = `You are writing a Final Portrait Report for a user of Harlow — a self-discovery program.

This report synthesises everything learned about the person through conversation over multiple sessions.

VOICE: Warm, precise, and human. Never clinical. Never generic. Write as though you genuinely know this person and are sharing something real about who they are.

STRUCTURE: Follow the 7-section format exactly as given in the prompt. Each section should feel complete and meaningful on its own.

FORMATTING: Use bold headers for each section. Write in flowing prose — no bullet points. Use specific observations from the context provided. Make it feel personal, not templated.`;

router.post('/', async (req, res) => {
  const { userId, prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  try {
    // Use a longer timeout for report generation — 55 seconds
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',  // Use Sonnet for report quality
        max_tokens: 2500,
        system: REPORT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error: ${err}`);
    }

    const data = await response.json();
    const report = data.content?.[0]?.text || '';

    if (!report) throw new Error('Empty report returned');

    res.json({ report });

  } catch(err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Report generation timed out — try again' });
    }
    console.error('Report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
