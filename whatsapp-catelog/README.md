# WhatsApp Business Catalog Manager

An admin panel for running a WhatsApp Business catalog on the **official Meta
WhatsApp Business Platform / Graph API**.

Add products, publish them to your Meta catalog, keep both sides in sync, send
products and collections to customers, and reply to them from a live inbox.

> **No unofficial anything.** There is no WhatsApp Web automation, no QR-code
> pairing, no scraping and no stored WhatsApp session. Every action is a Graph
> API call made by the server. If Meta does not expose an API for it, this app
> does not pretend to do it.

---

## Table of contents

1. [What it does](#1-what-it-does)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Meta setup](#4-meta-setup)
5. [Environment variables](#5-environment-variables)
6. [Local development](#6-local-development)
7. [Connecting your WhatsApp account](#7-connecting-your-whatsapp-account)
8. [Setting up the catalog](#8-setting-up-the-catalog)
9. [Daily workflow](#9-daily-workflow)
10. [Automation](#10-automation)
11. [API reference](#11-api-reference)
12. [Database schema](#12-database-schema)
13. [Security model](#13-security-model)
14. [Error handling](#14-error-handling)
15. [Testing the full flow](#15-testing-the-full-flow)
16. [Production deployment](#16-production-deployment)
17. [Troubleshooting](#17-troubleshooting)

---

## 1. What it does

| Area | Capability |
| --- | --- |
| **Onboarding** | Meta Embedded Signup, or connect an existing number with a System User token |
| **Accounts** | Multiple businesses, multiple WABAs, multiple phone numbers |
| **Catalog** | Connect an existing Meta catalog or create a new one |
| **Products** | Create, edit, publish, delete, activate/deactivate, bulk actions |
| **Media** | Multiple images per product (with a chosen main image) and videos |
| **Taxonomy** | Categories (nested) and collections (Meta product sets) |
| **Sync** | Two-way reconciliation with conflict detection and resolution |
| **Messaging** | Single product, multi-product, catalog message, text, media, templates |
| **Inbox** | Live two-way conversations over the webhook, with the 24h window enforced |
| **Automation** | Scheduled sync (cron) and keyword auto-replies |
| **Audit** | Every state-changing action recorded with actor, entity and result |

---

## 2. Architecture

```
client/  React 18 + Vite + React Router      (port 5174)
   |
   |  fetch /api/*   — the browser never calls Meta directly
   v
server/  NestJS 10 + Prisma 5                (port 4100)
   |
   |  axios -> graph.facebook.com/v25.0
   v
Meta WhatsApp Business Platform
   |
   |  webhook POST /api/whatsapp/webhook
   v
server -> PostgreSQL (Supabase)
```

### Backend layout

```
server/src/
  config/          every environment variable, read and typed in one file
  common/          error filter, AES-256-GCM token encryption
  prisma/          database client
  meta/            THE ONLY CODE THAT TALKS TO META
    meta-graph.service.ts      HTTP, pagination, appsecret_proof, uploads
    meta-error.ts              Graph errors -> human messages
    meta-token.service.ts      which token signs which call
    meta-business.service.ts   businesses, WABAs, numbers, webhooks
    meta-catalog.service.ts    catalogs, products, product sets
    meta-messaging.service.ts  sending, webhook signature verification
  whatsapp/        accounts, embedded signup, conversations, messaging, webhook
  catalog/         catalogs, products, categories, collections, sync
  automation/      scheduled sync + auto-reply rules
  audit/           append-only action log
  storage/         product media on disk, served publicly for Meta's crawler
```

The rule that shapes the whole backend: **`meta/` is the only directory that
knows `graph.facebook.com` exists.** Feature modules ask it for things; they
never build a Graph URL themselves, and they never see a raw Meta error.

### Frontend layout

```
client/src/
  lib/api.js       the single API client (no Meta URL anywhere in the bundle)
  lib/facebook.js  Embedded Signup — obtains a CODE only, never a token
  store/           auth, theme, toasts
  hooks/           useAsync (stale-response-safe), useAction, useDebounced
  components/ui/   the shared UI kit every page composes
  pages/           one file per screen
  styles/          design tokens -> base -> components -> layout
```

---

## 3. Prerequisites

- Node.js 18+
- A PostgreSQL database (this project is set up for Supabase)
- A Meta developer app with the WhatsApp product added
- A WhatsApp Business Account (WABA) with a registered phone number
- For local development: a tunnel (ngrok / cloudflared) — Meta cannot reach
  `localhost` for either webhooks or product images

---

## 4. Meta setup

### 4.1 Create the Meta app

1. Go to <https://developers.facebook.com/apps> → **Create App**
2. Choose **Business** as the app type
3. Add the **WhatsApp** product
4. Note the **App ID** and **App Secret** (Settings → Basic)

### 4.2 Business Portfolio

1. Open <https://business.facebook.com/settings>
2. Complete **business verification** — Meta blocks most catalog and messaging
   operations until this is done
3. Note the **Business Portfolio ID**

### 4.3 WhatsApp Business Account

Under the app's WhatsApp → API Setup you will find:

- **WhatsApp Business Account ID** (WABA ID)
- **Phone number ID**
- A temporary 24-hour access token (fine for a first test, useless in production)

### 4.4 Permissions

The app needs all four of these:

| Permission | Used for |
| --- | --- |
| `whatsapp_business_management` | WABA, phone numbers, webhook subscription |
| `whatsapp_business_messaging` | sending messages |
| `catalog_management` | products, catalogs, product sets |
| `business_management` | discovering businesses and their accounts |

### 4.5 A long-lived token

A 24-hour token will expire mid-workflow. Use a **System User** token instead:

1. Business Settings → **Users → System Users** → Add
2. Give it **Admin** access
3. **Assign Assets**: the WhatsApp Business Account *and* the catalog
4. **Generate New Token** → select your app → tick the four permissions above
5. Choose **Never** for expiry
6. Copy it into `META_ACCESS_TOKEN`

### 4.6 Embedded Signup (optional but recommended)

Lets you onboard accounts through Meta's own window instead of pasting ids.

1. App → **WhatsApp → Configuration → Login flow / Embedded Signup**
2. Create a configuration and note the **Configuration ID** → `META_CONFIG_ID`
3. App → **Facebook Login for Business → Settings**
4. Add your panel URL to **Valid OAuth Redirect URIs**:
   `https://your-domain.com/whatsapp/setup`
5. Add your domain to **Allowed Domains for the JavaScript SDK**

### 4.7 Webhook

1. App → **WhatsApp → Configuration → Webhook → Edit**
2. **Callback URL**: `https://your-domain.com/api/whatsapp/webhook`
3. **Verify token**: the same string as `META_WEBHOOK_VERIFY_TOKEN`
4. Click **Verify and save**
5. **Subscribe** to at least: `messages`. Also useful:
   `message_template_status_update`, `phone_number_quality_update`,
   `account_update`

> Connecting an account through this panel calls `POST /{waba-id}/subscribed_apps`
> for you, which is the step people usually forget. Without it Meta accepts the
> webhook URL but never delivers a message to it.

### 4.8 Catalog

Either let the panel create one (Catalog → Set up catalog → Create new), or
create it yourself in **Commerce Manager** and connect it. Either way the
catalog must be **assigned to the System User** if you are using a System User
token, or the catalog calls will 403.

---

## 5. Environment variables

Copy `server/.env.example` to `server/.env`.

### Server

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | | Default `4100` |
| `NODE_ENV` | | `development` / `production` |
| `CLIENT_ORIGIN` | | Comma-separated CORS allow-list. Default `http://localhost:5174` |
| `APP_PUBLIC_URL` | **yes** | Public HTTPS base URL of this server. Meta fetches product images from it and delivers webhooks to it. |

### Database

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | Runtime connection (Supabase transaction pooler, port 6543) |
| `DIRECT_URL` | **yes** | Migrations only (session pooler, port 5432) |

Percent-encode special characters in the password: `#` → `%23`, `$` → `%24`,
`,` → `%2C`.

### Meta

| Variable | Required | Notes |
| --- | --- | --- |
| `META_APP_ID` | for Embedded Signup | Public; safe in the browser |
| `META_APP_SECRET` | **yes** | Verifies webhook signatures and signs the token exchange. **Never** exposed. |
| `META_CONFIG_ID` | for Embedded Signup | Login-flow configuration id |
| `META_API_VERSION` | | Default `v25.0`. Bump here, not in code. |
| `META_GRAPH_BASE_URL` | | Default `https://graph.facebook.com` |
| `META_WEBHOOK_VERIFY_TOKEN` | **yes** | Must match what you typed into Meta |
| `META_ACCESS_TOKEN` | recommended | System User token; the fallback when an account has no stored credential |
| `META_BUSINESS_ID` | | Bootstrap hint |
| `META_WABA_ID` | | If set with a token, the account is imported on first boot |
| `META_PHONE_NUMBER_ID` | | Bootstrap hint |
| `META_CATALOG_ID` | | Bootstrap hint |

### Security

| Variable | Required | Notes |
| --- | --- | --- |
| `ENCRYPTION_KEY` | **yes** | 32 bytes of hex. Encrypts stored access tokens. Rotating it invalidates every stored token. |
| `AUTH_ENABLED` | | `true` in anything reachable from the internet |
| `JWT_SECRET` | **yes** | Long random string |
| `JWT_EXPIRES_IN` | | Default `12h` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | **yes** | Seeds the first admin on boot |

Generate the encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Media and automation

| Variable | Notes |
| --- | --- |
| `UPLOAD_DIR` | Default `../uploads` |
| `MAX_IMAGE_MB` | Default `8` |
| `MAX_VIDEO_MB` | Default `64` |
| `CATALOG_SYNC_ENABLED` | Default `true` |
| `CATALOG_SYNC_CRON` | 6-field cron. Default `0 30 2 * * *` (02:30 daily) |
| `AUTO_REPLY_ENABLED` | Default `true` |
| `WEBHOOK_LOGGING` | Stores raw webhook payloads for debugging |

> `.env` is in `.gitignore`. Keep it that way.

---

## 6. Local development

```bash
# from whatsapp-catelog/
npm run setup      # installs both apps and generates the Prisma client
npm run db:push    # creates the catalog tables
npm run dev        # API on :4100, UI on :5174
```

Open <http://localhost:5174>.

### Expose it to Meta

Meta must be able to reach your server for webhooks **and** for product images:

```bash
cloudflared tunnel --url http://localhost:4100
# or
ngrok http 4100
```

Then set `APP_PUBLIC_URL` to the tunnel URL and restart the server. Publishing a
product with a `localhost` image URL is refused up front with a clear message,
rather than failing obscurely at Meta.

### Useful commands

```bash
npm run build              # build both apps
npm run db:generate        # regenerate the Prisma client
npm --prefix server run prisma:studio   # browse the database
```

---

## 7. Connecting your WhatsApp account

Go to **WhatsApp → Connection** (`/whatsapp/setup`). Two supported paths:

### A. Embedded Signup (recommended)

Click **Connect with Meta**. Meta's own window opens; you pick the business,
the WhatsApp account and the number, and grant permissions. The browser
receives a short-lived `code`, posts it to this server, and the server:

1. exchanges the code for an access token using the app secret,
2. calls `debug_token` to confirm which WABAs were actually granted,
3. encrypts the token and stores it,
4. imports the WABA, its phone numbers and its catalogs,
5. subscribes the app to the WABA's webhooks.

### B. Server token (for a number that is already live)

If your number already works and you have a System User token in
`META_ACCESS_TOKEN`, click **Connect with server token**, pick the account, and
it is imported. Nothing is typed into the browser.

> If `META_WABA_ID` and `META_ACCESS_TOKEN` are both set, the account is
> imported automatically on first boot — you may find it already connected.

### Registering a number

A number Meta knows about but which is not live on the Cloud API shows a
**Register** button. Meta requires a 6-digit two-step verification PIN; pick one
and keep a record of it, because Meta asks for the same PIN if the number is
ever moved or re-registered.

---

## 8. Setting up the catalog

**Catalog → Set up catalog**:

- **Connect existing** — lists catalogs Meta can see for this business,
  showing which are already linked to WhatsApp
- **Create new** — creates a real catalog in your Business Portfolio and links
  it to the WABA

Then enable catalog visibility so customers can browse it from the chat:
**WhatsApp → Settings → Catalog in chat**.

---

## 9. Daily workflow

### Adding a product

1. **Catalog → Products → Add product**
2. Fill in name, description, price and category
3. **Save draft** — media attaches to a saved product
4. Open the **Images & video** tab and upload at least one image
   (Meta requires 500×500 or larger; JPG, PNG or WebP)
5. Optionally fill in **Property details** — property type, location, area,
   bedrooms, bathrooms, furnishing, possession, status, builder, contact
6. **Publish to WhatsApp**

Publishing validates first and refuses with a specific reason (no image, price
of zero, images not publicly reachable) rather than letting Meta reject it.

### Editing

Editing a product that is already live pushes the change to Meta automatically.
If Meta rejects it, the product is marked `FAILED` with the reason and stays
visible — it never silently looks published when it is not.

### Deleting

Deletion goes to **Meta first, then locally**. If Meta refuses, nothing is
removed here and the product is flagged as a conflict, because a local row
quietly disappearing while the item is still live in customers' WhatsApp is
much worse than an error message.

### Sending to a customer

From the products table, the product page, or the inbox:

- **Product** — a Single Product Message with a tappable card
  (optionally preceded by the product's own photos and videos)
- **Collection** — a Multi-Product Message, up to 30 items
- **Catalog** — opens your whole catalog in WhatsApp

All three are official WhatsApp interactive message types, and all three are
subject to the 24-hour customer service window.

---

## 10. Automation

### Scheduled sync

`CATALOG_SYNC_CRON` (default 02:30 daily) pulls every connected catalog from
Meta, reconciles it, and pushes any local changes still pending. Each run is
recorded in the sync history with counts and errors.

### Keyword auto-reply

**Automation → New rule.** A rule fires when an inbound message matches one of
its keywords and replies with text, a product, a collection, or the catalog.

Three things keep it from misbehaving:

- **Priority** — only the highest-priority matching rule fires, never two
- **Cooldown** — per customer, per rule (default 60 minutes)
- **Window awareness** — a closed 24-hour window is a silent skip, not an error

Use **Test a message** to see which rule would fire without sending anything.

Example: keywords `property details, send details, price` → reply with the
*Featured Properties* collection.

---

## 11. API reference

Everything requires a bearer JWT except the webhook and `/api/auth/*`.

### Auth
```
GET    /api/auth/config
POST   /api/auth/login
GET    /api/auth/me
```

### WhatsApp
```
GET    /api/whatsapp/status
GET    /api/whatsapp/accounts
GET    /api/whatsapp/accounts/:id
GET    /api/whatsapp/accounts/:id/credential      metadata only, never the token
POST   /api/whatsapp/accounts/:id/refresh
DELETE /api/whatsapp/accounts/:id

GET    /api/whatsapp/embedded-signup/config
POST   /api/whatsapp/embedded-signup
GET    /api/whatsapp/discover/businesses
GET    /api/whatsapp/discover/accounts
GET    /api/whatsapp/discover/phone-numbers
POST   /api/whatsapp/connect

POST   /api/whatsapp/accounts/:id/request-code
POST   /api/whatsapp/accounts/:id/verify-code
POST   /api/whatsapp/accounts/:id/register-number
POST   /api/whatsapp/accounts/:id/commerce-settings
```

### Inbox
```
GET    /api/whatsapp/conversations
GET    /api/whatsapp/conversations/:id
GET    /api/whatsapp/conversations/:id/messages
POST   /api/whatsapp/conversations/:id/read
PATCH  /api/whatsapp/conversations/:id
GET    /api/whatsapp/customers
GET    /api/whatsapp/messages/:id/media        proxied so the token stays server-side
```

### Sending
```
POST   /api/whatsapp/send-message
POST   /api/whatsapp/send-template
POST   /api/whatsapp/send-media
POST   /api/whatsapp/send-product
POST   /api/whatsapp/send-product-list
POST   /api/whatsapp/send-catalog
```

`POST /api/whatsapp/send-product`:

```json
{
  "to": "919263143179",
  "product_retailer_id": "PROPERTY-123",
  "body": "Here are the details you asked for",
  "includeMedia": true
}
```

### Catalog
```
GET    /api/catalog                       dashboard counters
GET    /api/catalog/catalogs
GET    /api/catalog/catalogs/discover
POST   /api/catalog/catalogs/connect
POST   /api/catalog/catalogs
POST   /api/catalog/catalogs/:id/default
```

### Products
```
GET    /api/catalog/products              search, filter, sort, paginate
POST   /api/catalog/products
GET    /api/catalog/products/:id
PUT    /api/catalog/products/:id
DELETE /api/catalog/products/:id
POST   /api/catalog/products/:id/publish
POST   /api/catalog/products/bulk
POST   /api/catalog/products/:id/images
POST   /api/catalog/products/:id/videos
POST   /api/catalog/products/:id/images/primary
DELETE /api/catalog/products/:id/media/:mediaId
```

### Categories / collections
```
GET|POST          /api/catalog/categories
PUT|DELETE        /api/catalog/categories/:id
POST              /api/catalog/categories/:id/products
POST              /api/catalog/categories/:id/products/remove

GET|POST          /api/catalog/collections
GET|PUT|DELETE    /api/catalog/collections/:id
POST              /api/catalog/collections/:id/publish
POST              /api/catalog/collections/:id/products
POST              /api/catalog/collections/:id/products/remove
```

### Sync / automation / audit
```
POST   /api/catalog/sync
GET    /api/catalog/sync/history
GET    /api/catalog/sync/conflicts
POST   /api/catalog/sync/conflicts/:productId/resolve

GET    /api/automation/status
POST   /api/automation/sync/run
GET|POST       /api/automation/auto-reply-rules
PUT|DELETE     /api/automation/auto-reply-rules/:id
POST           /api/automation/auto-reply-rules/:id/reset-cooldowns
POST           /api/automation/auto-reply-rules/preview

GET    /api/audit-logs
```

### Webhook
```
GET    /api/whatsapp/webhook     verification handshake
POST   /api/whatsapp/webhook     messages, statuses, account events
```

Both are unauthenticated by necessity — Meta cannot send a bearer token. Trust
comes from the verify token on GET and the `X-Hub-Signature-256` HMAC on POST.
Incoming messages are keyed on `meta_message_id` with a unique index, so a
replayed delivery cannot insert twice.

---

## 12. Database schema

Existing inbox tables (`customers`, `conversations`, `messages`, `admin_users`,
`webhook_logs`) are shared with the original inbox app and are **unchanged**.

New tables:

| Table | Purpose |
| --- | --- |
| `businesses` | Meta Business Portfolios |
| `whatsapp_accounts` | WABAs |
| `meta_credentials` | Encrypted access tokens, one per account |
| `whatsapp_phone_numbers` | Numbers, quality ratings, commerce settings |
| `catalogs` | Connected Meta catalogs |
| `categories` | Local taxonomy, nestable |
| `collections` / `collection_products` | Meta product sets |
| `products` | Catalog items with sync state |
| `product_media` | Images and videos |
| `catalog_sync_logs` | One row per sync run |
| `audit_logs` | Every state-changing action |
| `auto_reply_rules` / `auto_reply_dispatches` | Rules and per-customer cooldowns |

The hierarchy is `Business → WhatsappAccount → PhoneNumber / Catalog → Product`.
Nothing hardcodes a single number or catalog, so several businesses and several
numbers work without a schema change.

### Sync states

| State | Meaning |
| --- | --- |
| `SYNCED` | Local and Meta agree |
| `PENDING` | Local changes not yet pushed |
| `FAILED` | Meta rejected the last push — reason in `syncError` |
| `CONFLICT` | Both sides changed, or Meta no longer has it. Needs a decision. |

---

## 13. Security model

- **The access token never reaches the browser.** Not in a response, not in
  `localStorage`, not in a log line. The only token the frontend holds is our
  own admin JWT.
- **Tokens are encrypted at rest** with AES-256-GCM before being written, and
  live in a separate table so an ordinary account query cannot load one.
- **Embedded Signup gives the browser a `code`, not a token.** The exchange
  happens server-side with the app secret.
- **Webhook signatures** are verified with `X-Hub-Signature-256` against the raw
  request body using a timing-safe comparison.
- **`appsecret_proof`** is attached to every Graph call, so a stolen token alone
  cannot be replayed from elsewhere.
- **Every admin route requires a JWT.** Rate limits are tightened on login,
  sending and sync.
- **Meta errors are translated, not forwarded** — raw Graph payloads (which echo
  request internals) are logged server-side and never returned.
- **`.env` is gitignored.**

The one deliberately public path is `/media/*`, which serves product images.
Meta's crawler downloads them by URL and cannot present a token. Filenames are
random and nothing but uploaded product media is stored there.

---

## 14. Error handling

`server/src/meta/meta-error.ts` maps Graph failures to messages a business owner
can act on:

| Situation | What the user sees |
| --- | --- |
| Expired token (190/463) | "The Meta access token has expired. Reconnect this WhatsApp account." |
| Missing permission (200/10/299) | Names the four permissions that must be granted |
| Business not verified (10900) | "This Business Portfolio must complete Meta business verification." |
| Number already registered | "…already registered on another WhatsApp Business Account." |
| Wrong PIN (133005) | "The two-step verification PIN is incorrect." |
| Window closed (131047/131051) | "The 24-hour customer service window is closed. Send a template instead." |
| Image rejected | "Meta could not fetch or accept this image… at least 500×500, JPG or PNG." |
| Duplicate SKU | "A product with this SKU already exists in the catalog." |
| Rate limited (4/17/32/613/80007) | "Meta API rate limit reached…" — marked retryable |
| Network / timeout | "Could not reach the Meta API…" |

Each carries a stable `code` the frontend can branch on, plus `retryable`.

---

## 15. Testing the full flow

1. **Connect** — WhatsApp → Connection. Every checklist item should be green.
2. **Catalog** — Catalog → Set up catalog. Connect or create one.
3. **Create** — Add a product, save the draft, upload an image, publish.
4. **Verify at Meta** — the product appears in Commerce Manager.
5. **Edit** — change the price; Commerce Manager reflects it.
6. **Sync** — Catalog → Sync → Sync now. Counts should match, no conflicts.
7. **Conflict** — edit the same product in Commerce Manager *and* here, then
   sync: it should be flagged `CONFLICT`, not silently overwritten.
8. **Send** — send the product to your own WhatsApp. The card should arrive.
9. **Receive** — reply from your phone. It should appear in the inbox live.
10. **Reply** — answer from the inbox; it should arrive on your phone.
11. **Auto-reply** — create a keyword rule, message that keyword from your
    phone, and confirm the automatic answer.
12. **Delete** — delete the product; confirm it disappears from Commerce Manager.
13. **Audit** — every one of the above appears in the audit log.

Run the build before deploying:

```bash
npm run build
```

---

## 16. Production deployment

1. Set `NODE_ENV=production` and `AUTH_ENABLED=true`
2. Set `APP_PUBLIC_URL` to the real HTTPS domain
3. Set `CLIENT_ORIGIN` to the real frontend origin
4. Use a **permanent System User token**, not a temporary one
5. Generate a fresh `ENCRYPTION_KEY` and `JWT_SECRET`, and back the key up —
   losing it means every stored token must be reconnected
6. Change `ADMIN_PASSWORD` from the default
7. `npm run build`, then `npm start`
8. Serve `client/dist` from your web server or CDN
9. Point the Meta webhook at `https://your-domain.com/api/whatsapp/webhook`
10. For more than one server instance, move `UPLOAD_DIR` to shared storage
    (S3 or a mounted volume) — otherwise Meta can only fetch images that landed
    on the instance that received the upload

---

## 17. Troubleshooting

**Products publish but images do not appear**
`APP_PUBLIC_URL` is not publicly reachable. Meta's crawler must be able to
download the image URL. Check with `curl` from outside your network.

**"No catalog is connected"**
The catalog exists at Meta but is not linked to the WABA, or the token has no
`catalog_management`. If you use a System User token, the catalog must also be
**assigned** to that system user in Business Settings.

**Webhook verification fails**
`META_WEBHOOK_VERIFY_TOKEN` must match exactly what you typed into Meta, and the
callback URL must be HTTPS and publicly reachable.

**Messages send but nothing arrives in the inbox**
The app is not subscribed to the WABA's webhooks. Refresh the account from
WhatsApp → Connection, which calls `subscribed_apps` again, and check that the
`messages` field is ticked in the Meta webhook configuration.

**"The 24-hour customer service window is closed"**
Working as intended — a WhatsApp policy, not a bug. The customer must message
you first, or you must send an approved template.

**"The stored access token could not be read"**
`ENCRYPTION_KEY` changed. Reconnect the account.

**Sync reports conflicts after every run**
Something is editing the same products in Commerce Manager. Resolve each one
with **Keep mine** or **Use Meta's**, then run sync again.
