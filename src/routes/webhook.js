// src/routes/webhook.js
const express = require('express');
const router = express.Router();
const { handleMessage } = require('../services/conversation');
const { sendWhatsApp, validateTwilioSignature } = require('../services/twilio');

// Twilio sends URL-encoded form data
router.use(express.urlencoded({ extended: false }));

router.post('/whatsapp', async (req, res) => {
  // Always respond 200 to Twilio immediately
  res.status(200).send('<Response></Response>');

  const { From, Body } = req.body;
  if (!From || !Body) return;

  // Validate Twilio signature in production
  if (process.env.NODE_ENV === 'production') {
    if (!validateTwilioSignature(req)) {
      console.warn('Invalid Twilio signature from:', From);
      return;
    }
  }

  const phone = From.replace('whatsapp:', '');
  const text = Body.trim();

  if (!text) return;

  console.log(`[${new Date().toISOString()}] Message from ${phone}: ${text.slice(0, 80)}...`);

  try {
    const reply = await handleMessage(phone, text);
    if (reply) {
      await sendWhatsApp(phone, reply);
      console.log(`[${new Date().toISOString()}] Reply sent to ${phone}: ${reply.slice(0, 80)}...`);
    }
  } catch(err) {
    console.error('Error handling message:', err);
    try {
      await sendWhatsApp(phone, "something went wrong on my end — try again in a moment");
    } catch(e) {}
  }
});

// Health check for Twilio webhook validation
router.get('/whatsapp', (req, res) => {
  res.send('Harlow webhook is live');
});

module.exports = router;
