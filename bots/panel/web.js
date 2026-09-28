'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const swarm = require('../swarm');
const config = require('../config');
const { makeLogger } = require('../lib/logger');

const log = makeLogger('WEB');
const PUBLIC = path.join(__dirname, 'public');

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  return 'application/octet-stream';
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/' || urlPath === '/panel') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': contentType(file) });
  fs.createReadStream(file).pipe(res);
}

async function handleApi(req, res) {
  const url = req.url.split('?')[0];

  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  if (req.method === 'GET' && url === '/api/status') {
    return sendJson(res, 200, swarm.getStatus());
  }

  if (req.method === 'POST' && url === '/api/start') {
    const body = await readBody(req);
    return sendJson(res, 200, swarm.start({
      target: body.target,
      count: body.count,
      serverUrl: body.server || config.SERVER_URL,
      feedingMode: body.feedingMode,
    }));
  }

  if (req.method === 'POST' && url === '/api/stop') {
    return sendJson(res, 200, swarm.stop());
  }

  if (req.method === 'POST' && url === '/api/command') {
    const body = await readBody(req);
    const result = await runCommand(body);
    return sendJson(res, 200, result);
  }

  return null;
}

async function runCommand(body = {}) {
  const { cmd } = body;
  switch (cmd) {
    case 'pause': return swarm.togglePause();
    case 'pause_set': return swarm.setPaused(!!body.value);
    case 'add': return swarm.addBot();
    case 'remove': return swarm.removeBot(body.selector);
    case 'count': return swarm.setBotCount(body.count);
    case 'target': return swarm.setTarget(body.target);
    case 'mode': return swarm.setFeedingMode(body.mode);
    case 'config': return swarm.patchConfig(body.patch || {});
    case 'freeze': return swarm.freezeBot(body.selector, body.frozen !== false);
    case 'unfreeze': return swarm.freezeBot(body.selector, false);
    case 'explore': return swarm.forceExplore(body.selector);
    case 'sacrifice': return swarm.forceSacrifice(body.selector);
    case 'reconnect': return swarm.reconnectBot(body.selector);
    case 'start': return swarm.start(body);
    case 'stop': return swarm.stop();
    default:
      throw new Error('comando desconhecido: ' + cmd);
  }
}

function broadcast(wss, data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function startWebPanel(opts = {}) {
  const PORT = opts.port || process.env.BOTS_PANEL_PORT || 3001;
  const HOST = opts.host || process.env.BOTS_PANEL_HOST || '0.0.0.0';

  const server = http.createServer(async (req, res) => {
    try {
      const api = await handleApi(req, res);
      if (api === null && res.writableEnded === false && !res.headersSent) {
        serveStatic(req, res);
      }
    } catch (err) {
      log.info(`Erro: ${err.message}`);
      if (!res.headersSent) sendJson(res, 400, { error: err.message });
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'status', data: swarm.getStatus() }));
    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'command') {
          const data = await runCommand(msg);
          broadcast(wss, { type: 'status', data });
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', error: err.message }));
      }
    });
  });

  const unsubscribe = swarm.bus.on(() => {
    broadcast(wss, { type: 'status', data: swarm.getStatus() });
  });

  // Snapshot periódico mesmo sem eventos (massa/dist mudam todo tick)
  const snapTimer = setInterval(() => {
    if (wss.clients.size) {
      broadcast(wss, { type: 'status', data: swarm.getStatus() });
    }
  }, 1000);

  server.listen(PORT, HOST, () => {
    log.info(`Painel web em http://localhost:${PORT}/`);
    log.info(`WebSocket ws://localhost:${PORT}/ws`);
    log.info(`Bots → ${config.SERVER_URL}`);
  });

  return {
    server,
    wss,
    close() {
      unsubscribe();
      clearInterval(snapTimer);
      wss.close();
      server.close();
    },
  };
}

module.exports = { startWebPanel, runCommand };
