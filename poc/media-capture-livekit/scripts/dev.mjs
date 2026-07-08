import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const children = new Set();
let shuttingDown = false;

function binPath(name) {
  return path.join(rootDir, 'node_modules', '.bin', `${name}${isWindows ? '.cmd' : ''}`);
}

function runOnce(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: process.env,
      shell: isWindows,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function startLongRunning(name, command, args) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: process.env,
    shell: isWindows,
    stdio: 'inherit'
  });

  children.add(child);

  child.on('error', (error) => {
    console.error(`[dev] ${name} failed: ${error.message}`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    children.delete(child);

    if (!shuttingDown) {
      console.error(`[dev] ${name} exited (${signal ?? code ?? 'unknown'}).`);
      shutdown(code ?? 1);
    }
  });
}

function stopChild(child) {
  if (!child.pid) {
    return;
  }

  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }

  child.kill('SIGTERM');
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    stopChild(child);
  }

  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  console.log('[dev] Starting LiveKit container...');
  await runOnce('docker', ['compose', 'up', '-d', 'livekit']);

  console.log('[dev] Starting token endpoint on http://127.0.0.1:3001');
  startLongRunning('token endpoint', binPath('tsx'), ['server/token-server.ts']);

  console.log('[dev] Starting frontend on http://127.0.0.1:5173');
  startLongRunning('frontend', binPath('vite'), ['--host', '127.0.0.1']);

  console.log('[dev] Ready: open http://127.0.0.1:5173/?mode=host&room=wt-poc-room');
} catch (error) {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
}
