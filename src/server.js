// src/server.js
require('dotenv').config();
const express = require('express');
const app = express();

// ── Global CORS — must be FIRST, before all routes ──────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

const webhookRouter = require('./routes/webhook');
const apiRouter     = require('./routes/api');
const reportRouter  = require('./routes/report');

app.use('/webhook',    webhookRouter);
app.use('/api',        apiRouter);
app.use('/api/report', reportRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Harlow', time: new Date().toISOString() });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Harlow running on port ${PORT}`);
  try {
    const { startScheduler } = require('./services/scheduler');
    startScheduler();
  } catch(e) {}
});
