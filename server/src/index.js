'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');

const { connectDB } = require('./config/db');
const { attachSocket } = require('./socket');
const apiRoutes = require('./routes/api');
const wa = require('./services/whatsapp');

const PORT = Number(process.env.PORT) || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: [CLIENT_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'], credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

app.get('/health', (_req, res) =>
  res.json({ ok: true, uptime: process.uptime(), wa: wa.status().state })
);

app.use('/api', apiRoutes);

// Serve the built React app when it exists, so one process can host everything.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/socket\.io|\/health).*/, (_req, res) =>
    res.sendFile(path.join(clientDist, 'index.html'))
  );
}

app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

attachSocket(server, CLIENT_ORIGIN);

async function main() {
  await connectDB();

  server.listen(PORT, () => {
    console.log('');
    console.log('  WhatsApp Boat server');
    console.log(`  API    -> http://localhost:${PORT}/api`);
    console.log(`  Socket -> http://localhost:${PORT}`);
    console.log(`  Client -> ${CLIENT_ORIGIN}`);
    console.log('');
  });

  // Auto-start the WhatsApp client. With a saved LocalAuth session this
  // reconnects silently; otherwise it emits a QR for the UI to render.
  wa.initialize().catch((e) => console.error('[wa] startup:', e.message));
}

async function shutdown(signal) {
  console.log(`\n[server] ${signal} received, shutting down...`);
  try {
    if (wa.client) await wa.client.destroy();
  } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Puppeteer and the WhatsApp event handlers can fail outside any request, where
// Express never sees it. Record those to a file so a crash leaves evidence
// instead of just a dead process.
const CRASH_LOG = path.join(__dirname, '..', 'storage', 'crash.log');
function record(kind, err) {
  const detail = err && err.stack ? err.stack : String(err);
  const entry = `\n[${new Date().toISOString()}] ${kind}\n${detail}\n`;
  console.error(`[${kind}]`, detail);
  try {
    fs.appendFileSync(CRASH_LOG, entry);
  } catch {}
}

process.on('unhandledRejection', (reason) => record('unhandledRejection', reason));
process.on('uncaughtException', (err) => {
  record('uncaughtException', err);
  // Keep serving: one bad event should not take the whole session down.
});

main();
