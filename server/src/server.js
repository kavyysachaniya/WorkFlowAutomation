// Engine process: HTTP API + SSE + scheduler. Zero dependencies (node:sqlite, node:http).
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db.js';
import { createEngine } from './engine.js';
import { selectParser } from './parsers.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8788);
const DB_PATH = process.env.DB_PATH || join(here, '..', 'data', 'engine.db');

const parser = selectParser();
const db = openDb(DB_PATH);
const engine = createEngine({
  db,
  leaseMs: Number(process.env.LEASE_MS || 3000),
  tickMs: Number(process.env.TICK_MS || 250),
  maxConcurrency: Number(process.env.MAX_CONCURRENCY || 64),
  defaultDayMs: Number(process.env.DAY_MS || 3000),
});

const clients = new Set();
engine.events.on('event', (e) => {
  const line = `data: ${JSON.stringify(e)}\n\n`;
  for (const res of clients) res.write(line);
});
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000).unref();

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const m = req.method;
  try {
    if (m === 'GET' && p === '/api/health') return send(res, 200, { ok: true, owner: engine.owner, pid: process.pid });
    if (m === 'GET' && p === '/api/stats') return send(res, 200, engine.stats());
    if (m === 'GET' && p === '/api/config') return send(res, 200, engine.getConfig());
    if (m === 'PUT' && p === '/api/config') return send(res, 200, engine.setConfig(await readJson(req)));
    if (m === 'POST' && p === '/api/parse') {
      const { text, name } = await readJson(req);
      const out = await parser.parse(text, { name });
      const meta = { parser: parser.label, parser_id: parser.id, ai: parser.ai };
      return send(res, out.ok ? 200 : 422, out.ok ? { ...out, ...meta } : { error: 'Could not parse workflow', errors: out.errors, ...meta });
    }
    if (m === 'GET' && p === '/api/workflows') return send(res, 200, engine.listWorkflows());
    if (m === 'POST' && p === '/api/workflows') return send(res, 201, engine.createWorkflow(await readJson(req)));
    let mm;
    if (m === 'DELETE' && (mm = p.match(/^\/api\/workflows\/([\w-]+)$/))) return send(res, engine.archiveWorkflow(mm[1]) ? 200 : 404, { ok: true });
    if (m === 'POST' && p === '/api/events') return send(res, 202, engine.fireEvent(await readJson(req)));
    if (m === 'GET' && p === '/api/runs') return send(res, 200, engine.listRuns({ limit: url.searchParams.get('limit'), workflow_id: url.searchParams.get('workflow_id') }));
    if (m === 'GET' && (mm = p.match(/^\/api\/runs\/([\w-]+)$/))) {
      const run = engine.getRun(mm[1]);
      return run ? send(res, 200, run) : send(res, 404, { error: 'Run not found' });
    }
    if (m === 'GET' && p === '/api/deliveries') return send(res, 200, engine.listDeliveries({ limit: url.searchParams.get('limit') }));
    if (m === 'GET' && p === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`data: ${JSON.stringify({ type: 'hello', owner: engine.owner, at: Date.now() })}\n\n`);
      clients.add(res);
      res.on('close', () => clients.delete(res));
      return;
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, e.status || 500, { error: e.message, errors: e.errors });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`[engine] Port ${PORT} is already in use (a leftover engine process?). Stop it and retry.`);
  else console.error('[engine]', e.message);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[engine] pid ${process.pid} listening on http://127.0.0.1:${PORT} db=${DB_PATH}`);
  engine.start();
});
