// scripts/migrate.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migrations = [
  // ─── USERS ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number    TEXT UNIQUE NOT NULL,
    name            TEXT,
    timezone        TEXT DEFAULT 'UTC',
    preferred_time  TEXT DEFAULT '09:00',
    path            TEXT DEFAULT 'self_discovery', -- self_discovery|career|premium
    status          TEXT DEFAULT 'onboarding',      -- onboarding|active|paused|complete
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── SESSIONS ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
    session_number      INTEGER NOT NULL,
    phase               INTEGER DEFAULT 1,
    topic               TEXT,
    summary             TEXT,
    message_count       INTEGER DEFAULT 0,
    milestone_delivered BOOLEAN DEFAULT FALSE,
    started_at          TIMESTAMPTZ DEFAULT NOW(),
    ended_at            TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── MESSAGES ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID REFERENCES sessions(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL, -- user|assistant
    content     TEXT NOT NULL,
    signal_tags JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── SD TRAIT SCORES ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS sd_trait_scores (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
    category     TEXT NOT NULL,
    trait        TEXT NOT NULL,
    score        NUMERIC(8,2) DEFAULT 0,
    status       TEXT DEFAULT 'untested', -- untested|early|developing|strong|confirmed
    signal_count INTEGER DEFAULT 0,
    notes        TEXT,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, category, trait)
  )`,

  // ─── MILESTONES ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS milestones (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id   UUID REFERENCES sessions(id),
    trait_codes  TEXT[],
    milestone_type TEXT, -- pattern|strength|insight|contradiction
    content      TEXT NOT NULL,
    delivered_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── CAREER TRAIT SCORES ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS career_trait_scores (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
    category_num INTEGER NOT NULL, -- 1-12
    trait_code   TEXT NOT NULL,    -- e.g. '1A', '7C'
    score        NUMERIC(8,2) DEFAULT 0,
    status       TEXT DEFAULT 'untested',
    signal_count INTEGER DEFAULT 0,
    notes        TEXT,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, trait_code)
  )`,

  // ─── CAREER ARCHETYPES ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS career_archetypes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
    archetype_name TEXT NOT NULL,
    score          NUMERIC(8,2) DEFAULT 0,
    status         TEXT DEFAULT 'early', -- early|moderate|confirmed
    last_updated   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, archetype_name)
  )`,

  // ─── CAREER DIRECTIONS ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS career_directions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    direction_name  TEXT NOT NULL,
    tier            TEXT NOT NULL, -- primary|secondary|misfit
    strength_score  NUMERIC(5,2),
    supporting_cats INTEGER[],
    misfit_reasons  TEXT[],
    experiment      TEXT,
    last_updated    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, direction_name)
  )`,

  // ─── PROGRAM STATE ───────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS program_state (
    user_id                  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    session_number           INTEGER DEFAULT 0,
    phase                    INTEGER DEFAULT 1,
    priority_traits          TEXT[],
    active_contradictions    JSONB DEFAULT '[]',
    last_session_summary     TEXT,
    sessions_since_obs       INTEGER DEFAULT 0,
    observations_delivered   INTEGER DEFAULT 0,
    report_ready             BOOLEAN DEFAULT FALSE,
    report_delivered         BOOLEAN DEFAULT FALSE,
    -- Career fields
    leading_archetype        TEXT,
    secondary_archetype      TEXT,
    active_direction_cluster TEXT,
    active_misfit_signals    JSONB DEFAULT '[]',
    -- Premium fields
    premium_phase            INTEGER DEFAULT 1,
    router_last_mode         TEXT DEFAULT 'hybrid',
    sd_report_ready          BOOLEAN DEFAULT FALSE,
    career_report_ready      BOOLEAN DEFAULT FALSE,
    both_reports_ready       BOOLEAN DEFAULT FALSE,
    updated_at               TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── INDEXES ─────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sd_traits_user ON sd_trait_scores(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_career_traits_user ON career_trait_scores(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
];

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');
    for (const sql of migrations) {
      await client.query(sql);
    }
    console.log('✓ All migrations complete');
  } catch(err) {
    console.error('Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
