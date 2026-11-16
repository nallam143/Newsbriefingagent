# News Briefing Agent – Layered Architecture

Multi-layer news briefing system:

| Layer | Technology | Responsibility |
|-------|------------|----------------|
| **Frontend** | React + Vite | Dashboard, sources, briefings UI |
| **Backend** | Node.js + Express | API, RSS collection, SQLite, Telegram, scheduler |
| **AI Layer** | Python + FastAPI | Claude-powered briefing generation |

## Project Structure

```
news-briefing-layered/
├── frontend/          # React + Vite dashboard
├── backend/           # Node.js Express (API, DB, scheduler, Telegram)
└── ai-layer/          # Python FastAPI (Claude agent)
```

## Quick Start

### 1. AI Layer (Python FastAPI)

```bash
cd ai-layer
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Add your ANTHROPIC_API_KEY
python main.py
# Runs on http://localhost:8001
```

On Windows, start the AI service in its own terminal and keep it running:

```powershell
cd C:\Users\pc\Downloads\news-briefing-layered-with-langchain\ai-layer
.\.venv\Scripts\python.exe main.py
```

If **Run Pipeline Now** reports that it cannot connect to the AI service, check
`http://localhost:8001/health`. The backend's online indicator only confirms the
Node backend is running; the Python AI service must also be running. Check that
`AI_LAYER_URL` in `backend/.env` matches the AI service address. This connection
error occurs before the new briefing is saved or sent to Telegram.

### 2. Backend (Node.js)

```bash
cd backend
npm install
cp .env.example .env   # or create .env
# Set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
# AI_LAYER_URL=http://localhost:8001  (optional, default)
npm run dev
# Runs on http://localhost:3001
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173
```

## Environment

**AI Layer** (`ai-layer/.env`):
```
ANTHROPIC_API_KEY=your_claude_api_key
```

**Backend** (`backend/.env`):
```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
AI_LAYER_URL=http://localhost:8001
AI_PROVIDER=anthropic
```

## How It Works

1. Frontend talks to Backend REST API
2. Backend collects RSS, stores in SQLite
3. Backend calls AI Layer (`POST /briefing`) with articles
4. AI Layer uses Claude to generate structured briefing + markdown
5. Backend saves briefing and optionally posts to Telegram

The original CLI-based AI layer has been replaced with a proper FastAPI service.

## Send a briefing to a Telegram channel

1. Open [@BotFather](https://t.me/BotFather) in Telegram, use `/newbot`, and copy the bot token into `backend/.env` as `TELEGRAM_BOT_TOKEN`. Never put the token in frontend code or commit it.
2. Add your bot to the destination channel as an administrator and enable **Post Messages**.
3. To find a numeric channel ID, publish a new post in that channel after adding the bot. From the `backend` folder, run `npm run telegram:chats`. Copy the ID shown for your channel into `TELEGRAM_CHAT_ID` in `backend/.env`, including the minus sign (usually `-100...`). The helper reads recent bot updates without clearing them or sending messages. If another integration consumes updates or uses a webhook, obtain the ID from that integration instead.
4. Run `npm run telegram:check` from `backend` to verify the token, channel, and posting permission. This does not publish a test message.
5. Restart the backend, open a complete draft briefing, and click **Send to Telegram**. The button shows **Sending…**, then the briefing becomes **posted** after all messages succeed.

The existing scheduler can also auto-post; configuring Telegram enables that existing behavior. Review `CRON_SCHEDULE` before leaving the backend running.

### How the code works

`frontend/src/pages/BriefingDetail.jsx` handles the click. `frontend/src/services/api.js` calls `POST /api/briefings/:id/post`. The route calls `backend/src/agents/poster.js`, which loads the saved briefing and checks whether it was already posted. `backend/src/services/telegram.js` builds readable text from the saved sections and source URLs, splits it into messages, and sends each using the v2 Telegram client's `Api.sendMessage({ chat_id, text })`. Credentials are read only on the backend.

Long briefings are split below Telegram's 4096-character limit, including long single paragraphs and emoji. Plain text avoids Markdown parsing errors from AI-generated text. Messages are sent in order with a short pause. Concurrent sends of the same briefing share one delivery in a single backend process, and an already-posted briefing is not resent. Multiple backend processes are not coordinated by this in-memory guard.

Successful delivery IDs and failures are recorded in the `posts` table. If only part of a briefing is delivered, the page reports how many messages succeeded and leaves the briefing unposted. Retrying resends the entire briefing, so check the channel first. Network timeouts are not automatically retried because Telegram may already have received the message.

### Verification

From `backend`, run `npm test`. Tests use an in-memory database and a local Telegram stand-in with dummy credentials; they never post to a real channel. They cover HTTP delivery, long messages, simultaneous/repeated clicks, configuration, permission failures, rate limits, partial delivery, and timeouts.

For a Postman simulation, run `postman simulation run postman/simulations/telegram.sim.yaml --port 4010 --no-history --output ndjson` from the project root. In another PowerShell window, set `$env:TELEGRAM_MOCK_URL='http://127.0.0.1:4010/telegram'` and run `npm test` from `backend`. The mock is based on the [official Telegram sendMessage contract](https://core.telegram.org/bots/api#sendmessage); live delivery still requires your own valid bot token and channel permissions.
