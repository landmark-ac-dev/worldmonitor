#!/usr/bin/env node
// Container-only scheduling for existing seeders. Each seeder remains the owner
// of its data, last-good retention, record counts and seed-meta writes.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const LOCAL_REDIS_URL = 'http://redis-rest:80';
export const TV_SEED_JOBS = Object.freeze([
  Object.freeze({ name: 'aviation', script: 'seed-aviation.mjs', intervalMs: 10 * 60_000, timeoutMs: 5 * 60_000 }),
  Object.freeze({ name: 'cyber', script: 'seed-cyber-threats.mjs', intervalMs: 60 * 60_000, timeoutMs: 5 * 60_000 }),
]);
const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Do not inherit production credentials, provider keys or an alternate env file. */
export function localSeedEnvironment(env) {
  let url;
  try { url = new URL(env.UPSTASH_REDIS_REST_URL); } catch { /* rejected below */ }
  if (!url || url.protocol !== 'http:' || url.hostname !== 'redis-rest' || (url.port && url.port !== '80')
    || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    throw new Error('TV seed runner requires the Compose Redis REST service at http://redis-rest:80');
  }
  if (!env.UPSTASH_REDIS_REST_TOKEN?.trim()) throw new Error('TV seed runner requires the local Redis REST token');
  return {
    PATH: env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    NODE_ENV: 'production',
    NODE_OPTIONS: '--max-old-space-size=384 --dns-result-order=ipv4first',
    UPSTASH_REDIS_REST_URL: LOCAL_REDIS_URL,
    UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
    UPSTASH_ALLOW_INSECURE_HTTP: 'true',
    // Existing seeders use loadEnvFile(). Its supported explicit file override
    // reads this empty Linux file and stops; no checkout .env.local is loaded.
    WM_SEED_ENV_FILE: '/dev/null',
  };
}

/** Resolve only after child close, including after timeout: jobs cannot overlap. */
export function runSeedChild(job, {
  env, signal, spawnChild = spawn, timers = globalThis, killGraceMs = 5_000,
}) {
  if (signal.aborted) return Promise.resolve({ code: null, signal: null, aborted: true, timedOut: false });
  return new Promise((done) => {
    let child;
    let settled = false;
    let terminating = false;
    let timedOut = false;
    let aborted = false;
    let spawnError = false;
    let deadline;
    let killTimer;
    const cleanup = () => {
      if (deadline !== undefined) timers.clearTimeout(deadline);
      if (killTimer !== undefined) timers.clearTimeout(killTimer);
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (code, exitSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      done({ code, signal: exitSignal, aborted, timedOut, spawnError });
    };
    const terminate = () => {
      if (settled || terminating) return;
      terminating = true;
      child.kill('SIGTERM');
      if (!settled) killTimer = timers.setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, killGraceMs);
    };
    const onAbort = () => { aborted = true; terminate(); };
    try {
      child = spawnChild(process.execPath, [resolve(ROOT, 'scripts', job.script)], {
        cwd: ROOT, env, stdio: 'inherit', shell: false,
      });
    } catch {
      spawnError = true;
      finish(null, null);
      return;
    }
    child.once('error', () => { spawnError = true; });
    child.once('close', (code, exitSignal) => finish(code, exitSignal));
    deadline = timers.setTimeout(() => { timedOut = true; terminate(); }, job.timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export async function runTvSeedLoop({
  env, signal, jobs = TV_SEED_JOBS, runChild = runSeedChild, now = Date.now,
  wait = (ms, abortSignal) => sleep(ms, undefined, { signal: abortSignal }), logger = console,
}) {
  const childEnv = localSeedEnvironment(env);
  const nextRun = new Map(jobs.map(job => [job.name, 0]));
  while (!signal.aborted) {
    for (const job of jobs) {
      if (signal.aborted) break;
      if (now() < nextRun.get(job.name)) continue;
      logger.log(`[tv-seeds] starting ${job.name}`);
      const result = await runChild(job, { env: childEnv, signal });
      // Schedule from completion. Failed jobs wait too: no catch-up storm or
      // tight restart loop when an upstream provider or local Redis is down.
      nextRun.set(job.name, now() + job.intervalMs);
      const outcome = result.aborted ? 'stopped' : result.timedOut ? 'timed out'
        : result.spawnError ? 'could not start' : result.code === 0 ? 'completed' : `exited ${result.code ?? result.signal}`;
      logger.log(`[tv-seeds] ${job.name} ${outcome}; freshness remains owned by seed-meta`);
    }
    if (signal.aborted) break;
    const delay = Math.max(1, Math.min(...nextRun.values()) - now());
    try { await wait(delay, signal); } catch (error) { if (!signal.aborted) throw error; }
  }
}

async function main() {
  if (process.platform !== 'linux') throw new Error('Run TV seed scheduling inside its Linux Docker service');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try { await runTvSeedLoop({ env: process.env, signal: controller.signal }); }
  finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`[tv-seeds] ${error.message}`); process.exitCode = 1; });
}
