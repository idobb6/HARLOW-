// src/services/claude.js
require('dotenv').config();

// Uses raw fetch since Anthropic SDK may not be installed yet
// Replace with: const Anthropic = require('@anthropic-ai/sdk') once npm install runs

async function callClaude({ system, messages, maxTokens = 600 }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

module.exports = { callClaude };
