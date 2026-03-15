// src/server.js
require('dotenv').config();
const express = require('express');
const app = express();

const webhookRouter = require('./routes/webhook');
const apiRouter = require('./routes/api');
const { startScheduler } = require('./services/scheduler');

// Parse JSON for any JSON endpoints
app.use(express.json());

// Routes
app.use('/webhook', webhookRouter);  // WhatsApp (Twilio)
app.use('/api', apiRouter);          // Browser frontend

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Harlow',
    time: new Date().toISOString(),
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nHarlow server running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook/whatsapp`);
  console.log(`Health:      http://localhost:${PORT}/health\n`);
  startScheduler();
});
