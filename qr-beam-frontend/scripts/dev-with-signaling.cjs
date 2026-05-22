const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const signalingRoot = path.join(repoRoot, 'qr-beam-signaling');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = [
  spawn(npmCmd, ['run', 'start'], {
    cwd: signalingRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }),
  spawn(npmCmd, ['exec', 'vite', '--', '--host', '0.0.0.0'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }),
];

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(exitCode);
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) shutdown(code ?? 1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
