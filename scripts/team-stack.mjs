#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadTeamEnvironment } from './team-environment.mjs';
const team = loadTeamEnvironment();
const localMcpUrl = team.CONTEXT_PLANE_MCP_URL;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uri = team.MONGODB_URI;
const database = team.MONGODB_DATABASE;
const coordinationScope = team.CONTEXT_PLANE_COORDINATION_SCOPE;
const children = [];
let closing = false;
let stopped;
let finish;
const finished = new Promise(resolveFinished => { finish = resolveFinished; });

async function shutdown(code = 0) {
  if (stopped) return stopped;
  closing = true;
  stopped = (async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const force = setTimeout(() => {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 5000);
    await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve() : new Promise(resolveExit => child.once('close', resolveExit))));
    clearTimeout(force);
    process.exitCode = code;
    finish();
  })();
  return stopped;
}

function start(name, args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] });
  children.push(child);
  child.once('error', () => {
    if (!closing) { console.error(`${name} could not start.`); void shutdown(1); }
  });
  child.once('exit', () => {
    if (!closing) { console.error(`${name} exited; stopping the owned local stack.`); void shutdown(1); }
  });
}

async function checkPort(port) {
  await new Promise((resolvePort, reject) => {
    const socket = createServer();
    socket.once('error', () => reject(new Error(`Port ${port} is in use; stop its existing owner before starting this stack.`)));
    socket.listen(port, '127.0.0.1', () => socket.close(resolvePort));
  });
}

async function ready(name, url, headers = {}) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (closing) throw new Error('Local stack stopped during startup.');
    try {
      const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(1500) });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch { /* Wait for the listener and local database. */ }
    await delay(250);
  }
  throw new Error(`${name} did not become ready.`);
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.includes('--help')) {
    console.log('Usage: node scripts/team-stack.mjs. Reads private .env; starts API, MCP and HQ against the selected team Atlas database.');
    return;
  }
  if (flags.length) throw new Error('Unknown option. Use --help.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or newer is required.');
  for (const file of ['apps/api/dist/server.js', 'packages/mcp/dist/main.js', 'packages/mcp/dist/bridge.js',
    'packages/mcp/dist/smoke.js', 'apps/hq/dist/index.html']) {
    try { await access(resolve(root, file)); } catch { throw new Error('Build output is missing. Run npm ci and npm run build first.'); }
  }
  for (const port of [3001, 8010, 8787]) await checkPort(port);
  const { MongoClient } = await import('mongodb');
  const mongo = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, timeoutMS: 15000 });
  try {
    await mongo.connect();
    const hello = await mongo.db('admin').command({ hello: 1 });
    if (hello.setName !== 'atlas-13shhy-shard-0' || hello.isWritablePrimary !== true) throw new Error();
    await mongo.db(database).command({ ping: 1 });
  } catch { throw new Error('Team MongoDB is unavailable or not the expected replica set.'); }
  finally { await mongo.close(); }
  const token = team.CONTEXT_PLANE_API_TOKEN;
  const base = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'SystemRoot']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const shared = { ...base, ...team, NODE_ENV: 'production', MONGODB_URI: uri };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown(0); });
  start('API', [resolve(root, 'apps/api/dist/server.js')], root,
    { ...shared, PORT: '3001', CONTEXT_PLANE_DATABASE: database });
  start('MCP', [resolve(root, 'packages/mcp/dist/main.js')], root,
    { ...shared, HOST: '127.0.0.1', PORT: '8010', MONGODB_DATABASE: database,
      CONTEXT_PLANE_ORG_ID: team.CONTEXT_PLANE_ORG_ID, CONTEXT_PLANE_PROJECT_ID: team.CONTEXT_PLANE_PROJECT_ID,
      CONTEXT_PLANE_COORDINATION_SCOPE: coordinationScope, CONTEXT_PLANE_API_TOKEN: token });
  start('HQ', ['--import', 'tsx', 'server/index.ts'], resolve(root, 'apps/hq'),
    { ...base, NODE_ENV: 'production', PORT: '8787', HQ_MODE: 'runtime',
      CONTEXT_API_URL: 'http://127.0.0.1:3001', HQ_BROWSER_ORIGIN: 'http://127.0.0.1:8787' });
  await ready('API', 'http://127.0.0.1:3001/v1/projects/project_mvp_02/context', { 'x-demo-session': 'dev-a' });
  await ready('MCP', 'http://127.0.0.1:8010/readyz', { Authorization: `Bearer ${token}` });
  await ready('HQ', 'http://127.0.0.1:8787/api/meta');
  console.log('Team-backed stack ready: API http://127.0.0.1:3001 | MCP http://127.0.0.1:8010/mcp | HQ http://127.0.0.1:8787');
  console.log('Team Atlas database ' + database + '; shared API/MCP scope ' + team.CONTEXT_PLANE_ORG_ID + '/' + team.CONTEXT_PLANE_PROJECT_ID + '; no write smoke run.');
  await finished;
}

main().catch(async error => {
  if (!closing) console.error(error instanceof Error && !/mongodb|token|keychain/i.test(error.message)
    ? error.message : 'Team stack startup failed; credentials were not printed.');
  await shutdown(1);
});
