// src/services/conversation.js
const db = require('../db');
const { callClaude } = require('./claude');
const { SD_SYSTEM_PROMPT, buildContextBlock, parseSignals } = require('../prompts/selfDiscovery');

// ─── ONBOARDING ───────────────────────────────────────────────────────────────

async function handleOnboarding(user, incomingMessage) {
  if (!user.name) {
    const name = extractName(incomingMessage);
    if (name && incomingMessage.length > 1) {
      await db.updateUser(user.id, { name });
      return {
        reply: `nice to meet you, ${name}\n\nwhat time of day works best for you to chat?`,
        nextStatus: 'onboarding',
      };
    }
    return {
      reply: "hey — you found Harlow\n\nthis is a self-discovery program. not a quiz, not a test — conversations that build a real picture of who you are over time\n\nwhat should I call you?",
      nextStatus: 'onboarding',
    };
  }

  if (user.name && !user.preferred_time) {
    const time = extractTime(incomingMessage) || '09:00';
    await db.updateUser(user.id, { preferred_time: time });
    return {
      reply: `got it\n\nthe program runs 32 sessions, 4 times a week. by the end you'll have a real portrait of how you think, what drives you, and what you're like under pressure — built entirely from conversation\n\nno homework. no tests. just talking\n\nready to start?`,
      nextStatus: 'onboarding',
    };
  }

  if (user.name && user.preferred_time) {
    await db.updateUser(user.id, { status: 'active' });
    await db.updateProgramState(user.id, { session_number: 1 });
    return { reply: null, nextStatus: 'active', startSession: true };
  }

  return { reply: "what should I call you?", nextStatus: 'onboarding' };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

async function handleMessage(phone, incomingText) {
  let user = await db.getUserByPhone(phone);
  if (!user) user = await db.createUser(phone);

  if (user.status === 'onboarding') {
    const result = await handleOnboarding(user, incomingText);
    if (result.reply) return result.reply;
    if (!result.startSession) return "something went wrong — what should I call you?";
    user = await db.getUserByPhone(phone);
  }

  const state = await db.getProgramState(user.id);
  const sessionNumber = state.session_number || 1;
  const session = await db.getOrCreateSession(user.id, sessionNumber);

  // Get last 8 messages only — keeps context tight and fast
  const allMessages = await db.getSessionMessages(session.id);
  const recentMessages = allMessages.slice(-8);

  await db.saveMessage(session.id, user.id, 'user', incomingText);
  await db.updateSession(session.id, {
    message_count: (session.message_count || 0) + 1
  });

  const messages = [
    ...recentMessages,
    { role: 'user', content: incomingText }
  ];

  if (sessionNumber === 1 && allMessages.length === 0) {
    messages[messages.length - 1] = {
      role: 'user',
      content: '[START SESSION 1 — use your exact opening message]'
    };
  }

  // Keep context block small — top 3 traits only
  const traits = await db.getSDTraits(user.id);
  const recentSessions = await db.getRecentSessions(user.id, 2);
  const contextBlock = buildContextBlock(state, traits, recentSessions);

  const systemWithContext = `${SD_SYSTEM_PROMPT}\n\nCURRENT PROGRAM STATE:\n${contextBlock}`;

  const rawResponse = await callClaude({
    system: systemWithContext,
    messages,
    maxTokens: 500,
  });

  const { cleanText, signals } = parseSignals(rawResponse);

  await db.saveMessage(session.id, user.id, 'assistant', rawResponse, signals);

  if (signals?.trait_updates?.length) {
    for (const update of signals.trait_updates) {
      await db.updateSDTrait(
        user.id,
        update.category,
        update.trait,
        update.score_delta || 0,
        update.note
      );
    }
  }

  if (signals?.session_topic) {
    await db.updateSession(session.id, { topic: signals.session_topic });
  }

  await db.updateProgramState(user.id, {
    last_session_summary: signals?.session_topic || state.last_session_summary,
    sessions_since_obs: (state.sessions_since_obs || 0) + 1,
  });

  const updatedSession = await db.getOrCreateSession(user.id, sessionNumber);
  if ((updatedSession.message_count || 0) >= 20) {
    await endSession(user, session, state, sessionNumber);
  }

  return cleanText;
}

// ─── SESSION END ──────────────────────────────────────────────────────────────

async function endSession(user, session, state, sessionNumber) {
  const messages = await db.getSessionMessages(session.id);
  if (messages.length < 3) return;

  const summaryResponse = await callClaude({
    system: 'Summarize this conversation in 1-2 sentences. Focus on psychological signals.',
    messages: messages.slice(-6),
    maxTokens: 100,
  });

  await db.updateSession(session.id, {
    summary: summaryResponse,
    ended_at: new Date().toISOString(),
  });

  const nextSession = sessionNumber + 1;
  const nextPhase = nextSession <= 8 ? 1 : nextSession <= 16 ? 2 : nextSession <= 24 ? 3 : 4;

  await db.updateProgramState(user.id, {
    session_number: nextSession,
    phase: nextPhase,
    last_session_summary: summaryResponse,
  });
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function extractName(text) {
  const cleaned = text.trim().replace(/[.,!?]/g, '');
  const words = cleaned.split(' ');
  return words.slice(0, 2).map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}

function extractTime(text) {
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = m[2] ? parseInt(m[2]) : 0;
  const ampm = m[3]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}

module.exports = { handleMessage };
