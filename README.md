# WhatsApp Boat

A full WhatsApp Web client built on [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js).
React frontend, Node/Express backend, Socket.IO for live updates, MongoDB for persistence.

Link **as many WhatsApp numbers as you like**. Each account runs its own session, and you
switch between them in the sidebar without logging anything out. Scan a QR once per number
and you get that account's real chat list, real contacts, full conversation history, and
live two-way messaging.

---

## Quick start

```bash
npm run setup      # installs server + client dependencies
npm run dev        # starts both, API on :5000 and UI on :5173
```

Open <http://localhost:5173>. You land on the **accounts screen**:

1. Click **Add WhatsApp account** (optionally name it — "Sales", "Support", "Personal").
2. A QR dialog opens. Scan it from **WhatsApp → Settings → Linked devices → Link a device**.
3. The dialog closes itself once the account connects, and its chats load.
4. Repeat for every number you want to add.

Use the switcher at the top of the sidebar to move between accounts, or **Add or manage
accounts** to come back to the manager.

Each account's session is saved under `server/.wwebjs_auth/session-<id>/`, so restarts
reconnect every linked account silently — you only scan once per number.

### Single-process mode

```bash
npm start          # builds the React app and serves everything from :5000
```

---

## Configuration

`server/.env`:

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default `5000`) |
| `CLIENT_ORIGIN` | Allowed CORS origin (default `http://localhost:5173`) |
| `MONGODB_URI` | Mongo connection string |
| `CHROME_PATH` | Path to a local Chrome. Leave blank to use Puppeteer's bundled Chromium |
| `WA_HEADLESS` | `false` shows the Chrome window — useful when debugging a login |
| `WA_WEB_VERSION` | Pin a known WhatsApp Web build if a release breaks the library |

MongoDB is a **cache, not a requirement**. If the database is unreachable the server logs a
warning and keeps running on live WhatsApp data; only offline history and search degrade.

---

## What it does

**Accounts**
- Link unlimited WhatsApp numbers, each with its own browser session and media cache
- Accounts screen to add, name, reconnect, log out or remove any account
- Sidebar switcher with per-account unread badges, including accounts you are not reading
- QR rendered live over the websocket, with a reload button and sync progress
- Every linked account is restored automatically when the server restarts
- Removing an account deletes its session, cached chats and downloaded media

**Chats**
- Full chat list with avatars, last message, timestamps, unread badges, pin/mute markers
- Pinned chats float to the top, list re-sorts as messages arrive
- Pin, archive, mute, mark unread, clear messages, delete chat
- Search across chats, and a per-chat message search

**Contacts**
- Complete address book, grouped A–Z, with photos and numbers
- Click any contact to open that conversation
- Start a chat with any number, even one not in your contacts (validated against WhatsApp first)

**Conversations**
- Full history with paging — scroll up to load older messages
- Day separators, per-sender grouping, and sender names in groups
- Photos, videos, voice notes, audio, documents, stickers, locations, contact cards
- Photo/video lightbox with download
- Reply with quoted preview (click a quote to jump to the original)
- Reactions, forward to multiple chats, star, copy, delete for me / for everyone
- Delivery ticks: pending → sent → delivered → read
- `*bold*`, `_italic_`, `~strike~`, ` ```mono``` ` and auto-linked URLs

**Sending**
- Text, emoji picker, photos/videos, documents, audio, and your location
- Drag-free paste-to-attach, caption support, upload progress
- Sends a real "typing…" indicator to the other person

**Live**
- Incoming messages, ack updates, edits, deletions, and reactions all arrive over Socket.IO
- Optimistic send — your message appears instantly, then reconciles with the server

---

## Architecture

```
client/                 React + Vite
  src/store.jsx         Socket wiring, optimistic sends, all app state
  src/lib/api.js        REST client
  src/lib/format.js     Timestamps, previews, WhatsApp text markup
  src/components/       QR screen, sidebar, chat window, composer, dialogs

server/
  src/services/whatsapp.js  whatsapp-web.js wrapper (the engine)
  src/services/store.js     Mongo cache; every method no-ops if the DB is down
  src/routes/api.js         REST endpoints
  src/socket.js             Fans service events out to browsers
  src/models/               Message, Chat, Contact schemas
```

The Vite dev server proxies `/api` and `/socket.io` to port 5000, so the frontend uses
relative URLs and never hits CORS.

### API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/status` | Connection state, QR, linked account |
| `POST` | `/api/session/start` `/restart` `/logout` `/sync` | Session control |
| `GET` | `/api/chats` | Chat list |
| `GET` | `/api/chats/:id/messages?limit&offset` | History, paged |
| `POST` | `/api/chats/:id/seen` `/typing` `/action` | Read receipts, typing, chat actions |
| `GET` | `/api/contacts` · `/api/contacts/:id` | Address book and contact detail |
| `GET` | `/api/avatar/:id` | Cached profile photo (204 when none) |
| `GET` | `/api/media/:messageId` | Media, downloaded on demand and cached to disk |
| `POST` | `/api/messages/send` `/send-media` `/location` | Sending |
| `POST` | `/api/messages/:id/react` `/star` `/forward` | Message actions |
| `PATCH`/`DELETE` | `/api/messages/:id` | Edit / delete |
| `GET` | `/api/search?q=` | Message search |
| `POST` | `/api/numbers/resolve` · `/api/groups` | Number lookup, group creation |

---

## Notes and limits

- **One account per server instance.** The service is a singleton; `WA_SESSION_ID` exists so
  multi-session support is a small extension rather than a rewrite.
- **Receiving a "typing…" indicator is not supported** — whatsapp-web.js exposes no presence
  event for it. Sending one works, so the person you are chatting with does see yours.
- **Message paging re-fetches a widening window** rather than using a cursor, because
  whatsapp-web.js offers no cursor API. Practical for normal history depth.
- WhatsApp caps most media at 64 MB; the upload route enforces the same limit.
- This drives a real WhatsApp account through the web client. Bulk or automated messaging can
  get a number banned — WhatsApp does not permit unofficial clients for that.
