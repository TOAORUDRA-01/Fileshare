const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const signalingRoot = path.join(repoRoot, 'qr-beam-signaling');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const viteMode = process.argv[2] === 'preview' ? 'preview' : 'dev';
const viteArgs = viteMode === 'preview'
  ? [viteBin, 'preview', '--host', '0.0.0.0']
  : [viteBin, '--host', '0.0.0.0'];

const children = [
  spawn(process.execPath, ['server.js'], {
    cwd: signalingRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: false,
  }),
  spawn(process.execPath, viteArgs, {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: false,
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
  child.on('error', (err) => {
    console.error(err);
    shutdown(1);
  });

  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) shutdown(code ?? 1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
