/* Runs the NestJS API and the Vite dev server together. */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const procs = [
  { name: 'server', cwd: path.join(root, 'server'), args: ['run', 'dev'] },
  { name: 'client', cwd: path.join(root, 'client'), args: ['run', 'dev'] },
].map(({ name, cwd, args }) => {
  const child = spawn(npm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`);
    shutdown();
  });
  return child;
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  procs.forEach((p) => {
    try {
      p.kill();
    } catch {}
  });
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
