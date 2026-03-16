// src/services/claude.js
require('dotenv').config();

async function callClaude({ system, messages, maxTokens = 800 }) {
  const controller = new AbortController();
  // 25 second timeout — safely under Render free tier's 30s limit
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',  // faster model — reduces timeout risk
        max_tokens: maxTokens,
        system,
        messages,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || '';

  } catch(err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Claude API timed out after 25 seconds');
    }
    throw err;
  }
}

module.exports = { callClaude };
