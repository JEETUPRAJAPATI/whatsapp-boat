#!/usr/bin/env node
'use strict';

/**
 * Runs the API and the Vite dev server side by side with prefixed output,
 * so `npm run dev` from the repo root is all you need. No extra dependency.
 */

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const COLORS = { server: '\x1b[36m', client: '\x1b[35m', reset: '\x1b[0m' };

const children = [];

function run(name, cwd, args) {
  const child = spawn(npm, args, {
    cwd: path.join(ROOT, cwd),
    shell: process.platform === 'win32',
    env: process.env,
  });

  const prefix = `${COLORS[name]}[${name}]${COLORS.reset} `;
  const pipe = (stream, target) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) target.write(prefix + line + '\n');
    });
  };

  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
    shutdown();
  });

  children.push(child);
  return child;
}

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  for (const child of children) {
    try {
      child.kill();
    } catch {}
  }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Starting WhatsApp Boat...\n');
run('server', 'server', ['run', 'dev']);
run('client', 'client', ['run', 'dev']);
