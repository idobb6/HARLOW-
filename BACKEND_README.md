# Harlow

> *you are more complicated than you've been given credit for*

WhatsApp-based AI self-discovery program. 32 sessions, 19 psychological categories, 113 traits — built through casual conversation.

---

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database (free tier at [Neon](https://neon.tech) or [Supabase](https://supabase.com))
- [Anthropic API key](https://console.anthropic.com)
- [Twilio account](https://twilio.com) with WhatsApp Business enabled

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your keys:

```env
ANTHROPIC_API_KEY=sk-ant-...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
DATABASE_URL=postgresql://...
PORT=3000
NODE_ENV=development
```

### 3. Run database migrations

```bash
npm run migrate
```

### 4. Start the server

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

### 5. Expose to internet (for Twilio)

In development, use [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok.io`).

### 6. Configure Twilio webhook

1. Go to [Twilio Console](https://console.twilio.com)
2. Navigate to Messaging → Senders → WhatsApp Senders
3. Set Webhook URL to: `https://your-ngrok-url.ngrok.io/webhook/whatsapp`
4. Method: HTTP POST

### 7. Test

Send a WhatsApp message to your Twilio number. Harlow will respond.

---

## Deployment (Production)

### Railway (Recommended — free tier available)

1. Push code to GitHub
2. Create new project at [railway.app](https://railway.app)
3. Connect your GitHub repo
4. Add a PostgreSQL service (Railway provides one)
5. Set environment variables in Railway dashboard
6. Deploy — Railway auto-detects Node.js

Your webhook URL will be: `https://your-app.railway.app/webhook/whatsapp`

### Render

1. Push to GitHub
2. Create Web Service at [render.com](https://render.com)
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables
6. Create a PostgreSQL database and link it

### Fly.io

```bash
fly launch
fly secrets set ANTHROPIC_API_KEY=... TWILIO_ACCOUNT_SID=... # etc
fly deploy
```

---

## Architecture

```
WhatsApp User
     ↓
Twilio (webhook)
     ↓
POST /webhook/whatsapp
     ↓
conversation.js (main brain)
  ├── Get/create user
  ├── Handle onboarding
  ├── Build context block (program state + traits)
  ├── Call Claude API (system prompt + context + messages)
  ├── Parse response + signals
  ├── Update trait scores in DB
  └── Return clean response
     ↓
sendWhatsApp (Twilio)
     ↓
WhatsApp User

scheduler.js (runs hourly)
  └── Sends re-engagement nudges at user's preferred time
```

---

## File Structure

```
harlow/
├── src/
│   ├── server.js              # Express app entry point
│   ├── routes/
│   │   └── webhook.js         # Twilio webhook handler
│   ├── services/
│   │   ├── conversation.js    # Core conversation logic
│   │   ├── claude.js          # Anthropic API calls
│   │   ├── twilio.js          # WhatsApp send/receive
│   │   └── scheduler.js       # Re-engagement cron jobs
│   ├── db/
│   │   └── index.js           # Database queries
│   └── prompts/
│       └── selfDiscovery.js   # System prompt + signal parsing
├── scripts/
│   └── migrate.js             # Database schema creation
├── .env.example
├── package.json
└── README.md
```

---

## How It Works

### Signal Extraction
After every AI response, Claude outputs a `<signals>` JSON block containing:
- Which psychological traits were evidenced
- Score deltas per trait (2-15 points depending on signal strength)
- Session topic summary

This block is stripped before sending to the user. It's used to update the `sd_trait_scores` table.

### Context Injection
Every Claude API call includes the user's current program state:
- Session number and phase
- Top confirmed traits
- Recent session summaries
- Observations delivered

This keeps Claude's behavior coherent across 32 sessions.

### Scoring System
| Signal type | Points |
|-------------|--------|
| Direct statement | 2 |
| Indirect implication | 3 |
| Behavioral evidence | 6-8 |
| Full narrative with emotion | 10-15 |
| Repeated manner | 8 |

Trait status thresholds:
- 5+ pts: early
- 12+ pts: developing  
- 25+ pts: strong
- 45+ pts: confirmed

---

## Costs (Approximate)

| Service | Cost |
|---------|------|
| Claude Sonnet | ~$0.003-0.008 per conversation turn |
| Twilio WhatsApp | ~$0.005 per message sent |
| Railway/Render hosting | Free tier available |
| PostgreSQL | Free tier at Neon/Supabase |

For 100 active users at 4 sessions/week: ~$15-40/month in API costs.

---

## Extending to Career + Premium Paths

The codebase is structured for extension. To add Career Path:

1. Add `src/prompts/careerPath.js` (see Career AI Brain document)
2. Add career scoring tables in `scripts/migrate.js`
3. Add career logic in `src/services/conversation.js` (route by `user.path`)
4. Add archetype scoring service: `src/services/archetypes.js`

The `user.path` field already exists in the `users` table.

---

## WhatsApp Business API Approval

Getting WhatsApp Business API approval takes 1-3 weeks. Start immediately:

1. Go to [Twilio Console → Messaging → WhatsApp](https://console.twilio.com/us1/develop/sms/manage/whatsapp-senders)
2. Apply for WhatsApp Business Profile
3. Required: business name, website, use case description
4. While waiting: test on Twilio's sandbox number

---

*Harlow — Version 1.0*
