// src/services/conversation.js
const db = require('../db');
const { callClaude } = require('./claude');
const { SD_SYSTEM_PROMPT, buildContextBlock, parseSignals } = require('../prompts/selfDiscovery');

// ─── ONBOARDING STATE MACHINE ─────────────────────────────────────────────────

const ONBOARDING_STEPS = {
  START: 'start',
  AWAITING_NAME: 'awaiting_name',
  AWAITING_TIME: 'awaiting_time',
  AWAITING_CONFIRM: 'awaiting_confirm',
  COMPLETE: 'complete',
};

async function handleOnboarding(user, incomingMessage) {
  const status = user.status;

  if (status === 'onboarding' && !user.name) {
    // First message ever — send welcome
    if (!incomingMessage || incomingMessage.toLowerCase().includes('start') || incomingMessage.toLowerCase().includes('hi') || incomingMessage.toLowerCase().includes('hello')) {
      return {
        reply: "hey — you found Harlow\n\nthis is a self-discovery program. not a quiz, not a test — conversations that build a real picture of who you are over time\n\nwhat should I call you?",
        nextStatus: 'onboarding',
      };
    }
    // They replied with a name
    const name = extractName(incomingMessage);
    await db.updateUser(user.id, { name });
    return {
      reply: `nice to meet you, ${name}\n\nwhat time of day works best for you to chat? I'll schedule our sessions around that`,
      nextStatus: 'onboarding',
    };
  }

  if (status === 'onboarding' && user.name && !user.preferred_time) {
    const time = extractTime(incomingMessage) || '09:00';
    await db.updateUser(user.id, { preferred_time: time });
    return {
      reply: `got it — I'll check in around ${formatTime(time)}\n\nthe program runs 32 sessions, 4 times a week. by the end you'll have a real portrait of how you think, what drives you, and what you're like under pressure — built entirely from conversation\n\nno homework. no tests. just talking\n\nready to start?`,
      nextStatus: 'onboarding',
    };
  }

  if (status === 'onboarding' && user.name && user.preferred_time) {
    // They confirmed — start session 1
    await db.updateUser(user.id, { status: 'active' });
    await db.updateProgramState(user.id, { session_number: 1 });
    return {
      reply: null, // Signal to start session 1 immediately
      nextStatus: 'active',
      startSession: true,
    };
  }

  return { reply: "hey — what should I call you?", nextStatus: 'onboarding' };
}

// ─── MAIN CONVERSATION HANDLER ────────────────────────────────────────────────

async function handleMessage(phone, incomingText) {
  // Get or create user
  let user = await db.getUserByPhone(phone);
  if (!user) {
    user = await db.createUser(phone);
  }

  // Handle onboarding
  if (user.status === 'onboarding') {
    const result = await handleOnboarding(user, incomingText);
    if (result.reply) return result.reply;
    if (!result.startSession) return "something went wrong — let's start over. what should I call you?";
    // Fall through to start session 1
    user = await db.getUserByPhone(phone);
  }

  // Get program state
  const state = await db.getProgramState(user.id);
  const sessionNumber = state.session_number || 1;

  // Get or create current session
  const session = await db.getOrCreateSession(user.id, sessionNumber);

  // Get existing messages for this session
  const sessionMessages = await db.getSessionMessages(session.id);

  // Save incoming message
  await db.saveMessage(session.id, user.id, 'user', incomingText);
  await db.updateSession(session.id, {
    message_count: (session.message_count || 0) + 1
  });

  // Build conversation history for Claude
  const messages = [
    ...sessionMessages,
    { role: 'user', content: incomingText }
  ];

  // If this is the very first message of session 1, add the start signal
  if (sessionNumber === 1 && sessionMessages.length === 0) {
    messages[messages.length - 1] = {
      role: 'user',
      content: '[START SESSION 1 — use your exact opening message]'
    };
  }

  // Get trait context
  const traits = await db.getSDTraits(user.id);
  const recentSessions = await db.getRecentSessions(user.id, 3);
  const contextBlock = buildContextBlock(state, traits, recentSessions);

  // Build system prompt with context
  const systemWithContext = `${SD_SYSTEM_PROMPT}\n\nCURRENT PROGRAM STATE:\n${contextBlock}`;

  // Call Claude
  const rawResponse = await callClaude({
    system: systemWithContext,
    messages,
    maxTokens: 600,
  });

  // Parse response and signals
  const { cleanText, signals } = parseSignals(rawResponse);

  // Save assistant message
  await db.saveMessage(session.id, user.id, 'assistant', rawResponse, signals);

  // Process signals
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

  // Update session topic
  if (signals?.session_topic) {
    await db.updateSession(session.id, { topic: signals.session_topic });
  }

  // Update program state
  await db.updateProgramState(user.id, {
    last_session_summary: signals?.session_topic || state.last_session_summary,
    sessions_since_obs: (state.sessions_since_obs || 0) + 1,
  });

  // Check if session should end (after 15+ messages)
  const updatedSession = await db.getOrCreateSession(user.id, sessionNumber);
  if ((updatedSession.message_count || 0) >= 15) {
    await endSession(user, session, state, sessionNumber);
  }

  return cleanText;
}

// ─── SESSION END LOGIC ────────────────────────────────────────────────────────

async function endSession(user, session, state, sessionNumber) {
  // Generate session summary
  const messages = await db.getSessionMessages(session.id);
  if (messages.length < 3) return;

  const summaryResponse = await callClaude({
    system: 'Summarize this conversation in 1-2 sentences. Focus on what psychological signals emerged. Be specific.',
    messages: messages.slice(-10),
    maxTokens: 150,
  });

  await db.updateSession(session.id, {
    summary: summaryResponse,
    ended_at: new Date().toISOString(),
  });

  // Advance to next session
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
  // Take first 2 words max as name
  return words.slice(0, 2).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function extractTime(text) {
  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!timeMatch) return null;
  let hour = parseInt(timeMatch[1]);
  const min = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
  const ampm = timeMatch[3]?.toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  return `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}

function formatTime(time) {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${String(m).padStart(2,'0')} ${ampm}`;
}

module.exports = { handleMessage };
