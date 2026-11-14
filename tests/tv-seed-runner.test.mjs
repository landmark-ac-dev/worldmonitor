import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import { LOCAL_REDIS_URL, TV_SEED_JOBS, localSeedEnvironment, runSeedChild, runTvSeedLoop } from '../docker/tv-seed-runner.mjs';

const env = { UPSTASH_REDIS_REST_URL: LOCAL_REDIS_URL, UPSTASH_REDIS_REST_TOKEN: 'fake-local-test-token' };

test('only the local Compose Redis target and its explicit token reach existing seeders', () => {
  for (const url of ['https://hosted.upstash.io', 'http://localhost:8079', 'http://redis-rest:81',
    'http://redis-rest/path', 'http://user:secret@redis-rest', 'http://redis-rest?token=secret', 'http://redis-rest#fragment']) {
    assert.throws(() => localSeedEnvironment({ ...env, UPSTASH_REDIS_REST_URL: url }), /Compose Redis REST/);
  }
  assert.throws(() => localSeedEnvironment({ ...env, UPSTASH_REDIS_REST_TOKEN: '' }), /local Redis REST token/);
  const result = localSeedEnvironment({ ...env,
    AVIATIONSTACK_API: 'fake-paid-key', OTX_API_KEY: 'fake-provider-key',
    WM_SEED_ENV_FILE: '/other/.env.local', AXIOM_API_TOKEN: 'fake-telemetry-key',
    NODE_OPTIONS: '--import=unexpected-module',
  });
  assert.equal(result.UPSTASH_REDIS_REST_URL, LOCAL_REDIS_URL);
  assert.equal(result.UPSTASH_REDIS_REST_TOKEN, env.UPSTASH_REDIS_REST_TOKEN);
  assert.equal(result.WM_SEED_ENV_FILE, '/dev/null');
  assert.equal(result.AVIATIONSTACK_API, undefined);
  assert.equal(result.OTX_API_KEY, undefined);
  assert.equal(result.AXIOM_API_TOKEN, undefined);
  assert.doesNotMatch(result.NODE_OPTIONS, /unexpected/);
});

test('scheduler serializes immediate boot jobs, continues after failure and respects separate cadences', async () => {
  const controller = new AbortController();
  let now = 0;
  let running = 0;
  const starts = [];
  const logs = [];
  await runTvSeedLoop({ env, signal: controller.signal, now: () => now,
    logger: { log: line => logs.push(line) },
    runChild: async (job, options) => {
      assert.equal(running, 0, 'a previous child must have completed');
      assert.equal(options.env.UPSTASH_REDIS_REST_URL, LOCAL_REDIS_URL);
      running += 1;
      starts.push({ name: job.name, at: now });
      await Promise.resolve();
      now += 5;
      running -= 1;
      return { code: job.name === 'aviation' ? 1 : 0 };
    },
    wait: async ms => {
      assert.equal(running, 0);
      assert.ok(ms > 0);
      now += ms;
      if (now > 61 * 60_000) controller.abort();
    },
  });
  assert.deepEqual(starts.slice(0, 2).map(entry => entry.name), ['aviation', 'cyber']);
  for (const job of TV_SEED_JOBS) {
    const executions = starts.filter(entry => entry.name === job.name);
    assert.ok(executions.length >= 2, `${job.name} must recur`);
    for (let i = 1; i < executions.length; i += 1) {
      assert.ok(executions[i].at - executions[i - 1].at >= job.intervalMs);
    }
  }
  assert.ok(logs.some(line => line.includes('aviation exited 1')));
  assert.ok(logs.some(line => line.includes('cyber completed')));
});

function childHarness() {
  const child = new EventEmitter();
  const killed = [];
  const timers = new Map();
  let id = 0;
  child.kill = signal => { killed.push(signal); return true; };
  return { child, killed, timers, clock: {
    setTimeout: (callback, delay) => { timers.set(++id, { callback, delay }); return id; },
    clearTimeout: timerId => timers.delete(timerId),
  } };
}

test('timeout escalates TERM to KILL and waits for close before the next seed can start', async () => {
  const h = childHarness();
  const controller = new AbortController();
  let closed = false;
  const result = runSeedChild({ script: 'seed-aviation.mjs', timeoutMs: 100 }, {
    env: localSeedEnvironment(env), signal: controller.signal, timers: h.clock, killGraceMs: 5,
    spawnChild: (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.match(args[0], /scripts[/\\]seed-aviation\.mjs$/);
      assert.equal(options.shell, false);
      return h.child;
    },
  }).then(value => { closed = true; return value; });
  [...h.timers.values()].find(timer => timer.delay === 100).callback();
  assert.deepEqual(h.killed, ['SIGTERM']);
  [...h.timers.values()].find(timer => timer.delay === 5).callback();
  assert.deepEqual(h.killed, ['SIGTERM', 'SIGKILL']);
  await Promise.resolve();
  assert.equal(closed, false);
  h.child.emit('close', null, 'SIGKILL');
  assert.deepEqual(await result, { code: null, signal: 'SIGKILL', aborted: false, timedOut: true, spawnError: false });
  assert.equal(h.timers.size, 0);
  controller.abort();
  assert.equal(h.killed.length, 2);
});

test('shutdown terminates the running seed and never starts another scheduled job', async () => {
  const h = childHarness();
  const controller = new AbortController();
  const pending = runSeedChild({ script: 'seed-cyber-threats.mjs', timeoutMs: 100 }, {
    env: localSeedEnvironment(env), signal: controller.signal, timers: h.clock, spawnChild: () => h.child,
  });
  controller.abort();
  assert.deepEqual(h.killed, ['SIGTERM']);
  h.child.emit('close', null, 'SIGTERM');
  assert.equal((await pending).aborted, true);

  const loopController = new AbortController();
  const starts = [];
  await runTvSeedLoop({ env, signal: loopController.signal, logger: { log() {} },
    runChild: async job => { starts.push(job.name); loopController.abort(); return { code: 0, aborted: true }; },
    wait: async () => assert.fail('shutdown must not wait for another job'),
  });
  assert.deepEqual(starts, ['aviation']);
});

test('a child spawn failure is reported only after close', async () => {
  const h = childHarness();
  const controller = new AbortController();
  const pending = runSeedChild({ script: 'seed-cyber-threats.mjs', timeoutMs: 100 }, {
    env: localSeedEnvironment(env), signal: controller.signal, timers: h.clock, spawnChild: () => h.child,
  });
  h.child.emit('error', new Error('fixture spawn failure'));
  h.child.emit('close', -2, null);
  assert.equal((await pending).spawnError, true);
  assert.equal(h.timers.size, 0);
});

test('Compose keeps the recurrent seeds private, local and free of provider credentials', () => {
  const root = new URL('../', import.meta.url);
  const compose = parse(readFileSync(new URL('docker-compose.yml', root), 'utf8'));
  const seeds = compose.services['tv-seeds'];
  assert.equal(seeds.build.dockerfile, 'docker/Dockerfile.tv-seeds');
  assert.equal(seeds.environment.UPSTASH_REDIS_REST_URL, LOCAL_REDIS_URL);
  assert.match(seeds.environment.UPSTASH_REDIS_REST_TOKEN, /^\$\{REDIS_TOKEN:\?/);
  assert.deepEqual(Object.keys(seeds.environment).sort(), ['UPSTASH_ALLOW_INSECURE_HTTP', 'UPSTASH_REDIS_REST_TOKEN', 'UPSTASH_REDIS_REST_URL']);
  assert.equal(seeds.ports, undefined);
  assert.equal(seeds.env_file, undefined);
  assert.equal(seeds.volumes, undefined);
  assert.equal(seeds.restart, 'unless-stopped');
  assert.equal(seeds.init, true);
  const image = readFileSync(new URL('docker/Dockerfile.tv-seeds', root), 'utf8');
  assert.match(image, /npm ci --prefix scripts/);
  assert.match(image, /COPY scripts\/ \.\/scripts\//);
  assert.match(image, /COPY src\/config\/airports\.ts/);
  assert.match(image, /USER node/);
});
