// src/services/scheduler.js
require('dotenv').config();
const cron = require('node-cron');
const db = require('../db');
const { sendWhatsApp } = require('./twilio');

const RE_ENGAGEMENT_MESSAGES = [
  "quick question — what's the last thing you worked on that actually held your attention",
  "something I've been curious about — what does a good day look like for you",
  "what's something you've gotten noticeably better at over the last year or two",
  "what kind of problems do you actually enjoy solving",
  "what kinds of tasks make time pass quickly for you",
  "do you think most people know what actually drives them, or do they just think they do",
  "what's been on your mind lately",
  "what's the last thing you taught yourself just because you were curious",
  "what does rest actually look like for you — like genuinely switching off",
  "when was the last time you felt genuinely proud of something you did",
];

// Run every hour, check who needs a nudge
function startScheduler() {
  cron.schedule('0 * * * *', async () => {
    await checkAndSendNudges();
  });
  console.log('Scheduler started — checking hourly');
}

async function checkAndSendNudges() {
  try {
    // Find active users who haven't had a message in 20+ hours
    const { rows: dueUsers } = await db.query(`
      SELECT u.id, u.phone_number, u.name, u.preferred_time, u.timezone,
             ps.session_number, ps.last_session_summary,
             MAX(m.created_at) as last_message_at
      FROM users u
      JOIN program_state ps ON ps.user_id = u.id
      LEFT JOIN messages m ON m.user_id = u.id
      WHERE u.status = 'active'
        AND (
          m.created_at IS NULL OR
          m.created_at < NOW() - INTERVAL '20 hours'
        )
      GROUP BY u.id, ps.session_number, ps.last_session_summary
      HAVING COUNT(CASE WHEN m.role = 'assistant' THEN 1 END) < 4  -- max 4 sessions/week
    `);

    for (const user of dueUsers) {
      const now = new Date();
      const preferredHour = parseInt((user.preferred_time || '09:00').split(':')[0]);
      const currentHour = now.getUTCHours();

      // Only send within 1 hour of their preferred time
      if (Math.abs(currentHour - preferredHour) > 1) continue;

      // Check if they've been silent too long (pause after 14 days)
      if (user.last_message_at) {
        const daysSilent = (now - new Date(user.last_message_at)) / (1000 * 60 * 60 * 24);
        if (daysSilent > 14) {
          await sendReEngagementMessage(user, 'return');
          continue;
        }
      }

      await sendReEngagementMessage(user, 'regular');
    }
  } catch(err) {
    console.error('Scheduler error:', err.message);
  }
}

async function sendReEngagementMessage(user, type) {
  let message;

  if (type === 'return') {
    message = user.name
      ? `hey ${user.name} — it's been a while. no pressure, just checking in. anything on your mind?`
      : "hey — it's been a while. no pressure, just checking in. anything on your mind?";
  } else {
    // Pick a message the user hasn't seen recently
    const { rows: recent } = await db.query(
      `SELECT content FROM messages
       WHERE user_id = $1 AND role = 'assistant'
       ORDER BY created_at DESC LIMIT 20`,
      [user.id]
    );
    const recentTexts = recent.map(r => r.content);
    const unused = RE_ENGAGEMENT_MESSAGES.filter(m =>
      !recentTexts.some(t => t.includes(m.slice(0, 30)))
    );
    const pool = unused.length > 0 ? unused : RE_ENGAGEMENT_MESSAGES;
    message = pool[Math.floor(Math.random() * pool.length)];
    if (user.name && Math.random() > 0.7) {
      message = `hey ${user.name} — ` + message;
    }
  }

  try {
    await sendWhatsApp(user.phone_number, message);
    // Log as assistant message
    const state = await db.getProgramState(user.id);
    const session = await db.getOrCreateSession(user.id, state.session_number || 1);
    await db.saveMessage(session.id, user.id, 'assistant', message);
    console.log(`Nudge sent to ${user.phone_number}`);
  } catch(err) {
    console.error(`Failed to send nudge to ${user.phone_number}:`, err.message);
  }
}

module.exports = { startScheduler };
