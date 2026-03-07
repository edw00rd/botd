import { spawn } from 'node:child_process';

// Starts a local server and runs Playwright tests against it.
const server = spawn('npx', ['http-server', '-p', '8080', '-c-1', '.'], { stdio: 'inherit' });

const shutdown = () => {
  try { server.kill('SIGTERM'); } catch (_) {}
};
process.on('SIGINT', () => { shutdown(); process.exit(1); });
process.on('SIGTERM', () => { shutdown(); process.exit(1); });

// Give server a moment.
setTimeout(() => {
  const test = spawn('npx', ['playwright', 'test'], { stdio: 'inherit', env: { ...process.env, BASE_URL: 'http://127.0.0.1:8080' } });
  test.on('exit', (code) => {
    shutdown();
    process.exit(code ?? 1);
  });
}, 800);
