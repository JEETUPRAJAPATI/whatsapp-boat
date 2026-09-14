# Meta WhatsApp Cloud API Inbox

A two-way WhatsApp customer support system built on the **official Meta WhatsApp Cloud API**.

```
Customer's WhatsApp
        |
Meta WhatsApp Cloud API
        |
POST /api/whatsapp/webhook      <- NestJS backend
        |
PostgreSQL (Supabase, via Prisma)
        |
Socket.IO  ->  Admin inbox (React)
        |
POST /api/whatsapp/send-message
        |
Meta Graph API  ->  Customer's WhatsApp
```

* **Backend** - NestJS 10 + Prisma + PostgreSQL + Socket.IO (`server/`)
* **Frontend** - React 18 + Vite, WhatsApp Web style dark UI (`client/`)
* The access token lives **only** on the server. The browser talks to our API, never to Meta.

---

## 1. Requirements

* Node.js 18+ (tested on 20)
* A PostgreSQL database (this project is configured for Supabase)
* A Meta app with the WhatsApp product added

---

## 2. Install and configure

```bash
cd meta-whatsapp
npm run setup            # installs server + client dependencies
```

Copy the example environment file and fill it in:

```bash
cp server/.env.example server/.env
```

| Variable | What it is |
| --- | --- |
| `META_WHATSAPP_ACCESS_TOKEN` | Access token from Meta. **Never commit this.** |
| `META_WHATSAPP_PHONE_NUMBER_ID` | Phone number ID shown under WhatsApp > API setup |
| `META_WHATSAPP_BUSINESS_ACCOUNT_ID` | WhatsApp Business Account (WABA) ID |
| `META_WHATSAPP_API_VERSION` | Graph API version, e.g. `v25.0` |
| `META_WHATSAPP_VERIFY_TOKEN` | Any random string **you** invent; must match Meta exactly |
| `META_APP_SECRET` | App secret from App settings > Basic. Enables webhook signature checks |
| `DATABASE_URL` | Postgres pooled connection (Supabase port 6543) |
| `DIRECT_URL` | Postgres direct connection (port 5432), used by Prisma migrations |
| `AUTH_ENABLED` | `false` skips the sign-in screen entirely. See the warning below |
| `JWT_SECRET` | Long random string for admin session tokens |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeded on first boot; change before going live |

> **Password encoding:** if your database password contains `#`, `$`, `,`, `@`, `/` or `:`
> it must be percent-encoded in the URL (`#` -> `%23`, `$` -> `%24`, `,` -> `%2C`).
> An unencoded `#` silently truncates the connection string.

Create the tables:

```bash
cd server
npx prisma db push       # or: npx prisma migrate dev
```

---

## 3. Run locally

```bash
# from meta-whatsapp/
npm run dev              # starts the API on :4000 and the UI on :5173
```

Open <http://localhost:5173> and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### Running without a login

Set `AUTH_ENABLED=false` in `server/.env` to drop the sign-in screen and open the
inbox directly. Handy on a laptop.

> **Do not do this on anything the internet can reach** - a public tunnel URL
> included. With auth off, every admin route is open: anyone with the address can
> read all customer conversations and send WhatsApp messages from your business
> number. Set `AUTH_ENABLED=true` before deploying. The server prints a warning on
> every boot while it is off.

The Vite dev server proxies `/api` and `/socket.io` to the backend, so the browser
never needs to know the API's address or hold any Meta credential.

---

## 4. Meta dashboard configuration

### 4.1 Get a public HTTPS URL

Meta will not deliver webhooks to `localhost`. During development, tunnel your API:

```bash
npx localtunnel --port 4000
# or
ngrok http 4000
# or
cloudflared tunnel --url http://localhost:4000
```

You will get something like `https://abc123.ngrok-free.app`.

### 4.2 Configure the webhook

1. Go to **Meta for Developers > your app > WhatsApp > Configuration**.
2. Under **Webhook**, click **Edit**.
3. **Callback URL:** `https://YOUR_PUBLIC_URL/api/whatsapp/webhook`
4. **Verify token:** exactly the value of `META_WHATSAPP_VERIFY_TOKEN` in `server/.env`.
5. Click **Verify and save**.

Meta sends `GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`.
The server compares the token and echoes `hub.challenge`, which is what makes the
green checkmark appear. A mismatch returns **403** and Meta shows a verification error.

### 4.3 Subscribe to events

Still under **Configuration > Webhook fields**, click **Manage** and subscribe to:

* **`messages`** - required. This single field covers incoming messages **and**
  the `sent` / `delivered` / `read` / `failed` status updates.

### 4.4 Register the phone number

Under **WhatsApp > API setup**, note the **Phone number ID** and the **WhatsApp
Business Account ID**, and copy them into `server/.env`. Add the phone number you
will test with under **To > Manage phone number list** (required while the app is
in Development mode).

### 4.5 Access tokens

The temporary token on the API setup page **expires in 24 hours**. For anything
beyond a first test, create a permanent token:

1. **Business Settings > Users > System users > Add** (role: Admin).
2. **Add assets** -> your WhatsApp app and WABA, with full control.
3. **Generate new token** -> select the app -> tick `whatsapp_business_messaging`
   and `whatsapp_business_management` -> set expiry to **Never**.
4. Put that token in `META_WHATSAPP_ACCESS_TOKEN` and restart the server.

---

## 5. End-to-end test with a real number

1. Start the backend and the tunnel; confirm the webhook is verified in Meta.
2. From a phone, send a WhatsApp message to your business number.
3. The server logs `[WhatsApp Webhook] Incoming message wamid... (text) from ****1234`.
4. The conversation appears in the inbox **without a page refresh**, with an unread badge.
5. Open it, type a reply, press **Enter**.
6. The server logs `[WhatsApp API] Message sent to ****1234 (wamid...)`.
7. The message arrives on the phone; ticks in the UI turn to delivered, then read.

### The 24-hour rule

WhatsApp only allows free-form text within **24 hours** of the customer's last
message. Outside that window the composer is replaced with a **Send template**
button, and `POST /api/whatsapp/send-message` returns:

```json
{ "statusCode": 400, "code": "SERVICE_WINDOW_CLOSED", "message": "The 24-hour customer service window is closed..." }
```

Use `POST /api/whatsapp/send-template` with an approved template instead.

---

## 6. API reference

All `/api/whatsapp/*` routes except the webhook require `Authorization: Bearer <token>`.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Sign in, returns a JWT |
| `GET` | `/api/auth/me` | Current admin |
| `GET` | `/api/whatsapp/webhook` | Meta verification handshake (public) |
| `POST` | `/api/whatsapp/webhook` | Meta event delivery (public, HMAC-verified) |
| `GET` | `/api/whatsapp/status` | Config health, no secrets |
| `GET` | `/api/whatsapp/conversations` | List, `?search=`, `?status=` |
| `GET` | `/api/whatsapp/conversations/:id` | One conversation |
| `GET` | `/api/whatsapp/conversations/:id/messages` | History, `?limit=&before=` |
| `POST` | `/api/whatsapp/conversations/:id/read` | Clear unread + send a read receipt |
| `PATCH` | `/api/whatsapp/conversations/:id` | Assign / close / reopen |
| `POST` | `/api/whatsapp/send-message` | Send free-form text |
| `POST` | `/api/whatsapp/send-template` | Send an approved template |
| `POST` | `/api/whatsapp/send-media` | Send an image / video / audio / document (multipart) |
| `GET` | `/api/whatsapp/messages/:id/media` | Streams a message's media through the server |
| `GET` | `/api/whatsapp/customers` | Customer directory |

### Socket.IO events

| Event | Payload |
| --- | --- |
| `whatsapp:new-message` | `{ conversationId, customer, message }` |
| `whatsapp:message-status` | `{ conversationId, metaMessageId, status, error }` |
| `whatsapp:conversation` | `{ conversation }` - list row changed |

---

## 7. curl examples

```bash
# Sign in
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}' | jq -r .accessToken)

# Webhook verification (what Meta does)
curl "http://localhost:4000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=12345"

# Simulate an incoming customer message
curl -X POST http://localhost:4000/api/whatsapp/webhook \
  -H 'Content-Type: application/json' \
  -d '{"object":"whatsapp_business_account","entry":[{"id":"WABA_ID","changes":[{"field":"messages","value":{
        "messaging_product":"whatsapp",
        "metadata":{"display_phone_number":"15550001111","phone_number_id":"PHONE_NUMBER_ID"},
        "contacts":[{"profile":{"name":"Riya"},"wa_id":"919812345678"}],
        "messages":[{"from":"919812345678","id":"wamid.TEST1","timestamp":"1788960000","type":"text","text":{"body":"Hello"}}]
      }}]}]}'

# Simulate a delivery status
curl -X POST http://localhost:4000/api/whatsapp/webhook \
  -H 'Content-Type: application/json' \
  -d '{"object":"whatsapp_business_account","entry":[{"id":"WABA_ID","changes":[{"field":"messages","value":{
        "messaging_product":"whatsapp",
        "metadata":{"display_phone_number":"15550001111","phone_number_id":"PHONE_NUMBER_ID"},
        "statuses":[{"id":"wamid.OUT1","status":"delivered","timestamp":"1788960200","recipient_id":"919812345678"}]
      }}]}]}'

# List conversations
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/whatsapp/conversations

# Reply
curl -X POST http://localhost:4000/api/whatsapp/send-message \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"to":"919812345678","type":"text","message":"Hello from support"}'

# Media (image, video, audio, document)
curl -X POST http://localhost:4000/api/whatsapp/send-media \
  -H "Authorization: Bearer $TOKEN" \
  -F 'to=919812345678' \
  -F 'caption=Here is your receipt' \
  -F 'file=@./receipt.png'

# Template
curl -X POST http://localhost:4000/api/whatsapp/send-template \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"to":"919812345678","template_name":"hello_world","language":"en_US"}'
```

---

## 8. Tests

```bash
cd server && npm test
```

Covers webhook verification (valid, wrong token, wrong mode), signature checking,
incoming text and image parsing, customer/conversation creation, unread counting,
duplicate webhook suppression, status transitions including out-of-order and
failure details, and the 24-hour window calculation.

---

## 9. Security notes

* `META_WHATSAPP_ACCESS_TOKEN` is read only in `whatsapp.service.ts`, sent only as a
  bearer header to `graph.facebook.com`, and never logged or returned by any endpoint.
* Phone numbers are masked in logs (`****5678`).
* `POST` webhooks are validated against `X-Hub-Signature-256` when `META_APP_SECRET`
  is set; without it the check is skipped and a warning is logged.
* Every admin route is behind a JWT guard - an unauthenticated caller cannot send a message.
* Rate limits: 300 req/min globally, 60/min on send-message, 30/min on send-template,
  10/min on login. The webhook is exempt so Meta is never throttled.
* `meta_message_id` is unique, so a replayed webhook cannot duplicate a message.
* `.env` is git-ignored.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Webhook verification fails in Meta | `META_WHATSAPP_VERIFY_TOKEN` differs from the value typed into Meta, or the URL is missing `/api/whatsapp/webhook` |
| Nothing arrives when a customer messages | The `messages` webhook field is not subscribed, or the tunnel URL changed |
| `access token is invalid or expired` | The 24-hour test token expired - create a permanent system-user token |
| `24-hour customer service window is closed` | Correct behaviour - use a template |
| `Template rejected by Meta` | Template name/language wrong or not approved yet |
| Prisma cannot connect | Percent-encode special characters in the database password |
