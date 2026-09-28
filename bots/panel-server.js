'use strict';

/**
 * Só o painel web/API (sem terminal interativo).
 * Compatível com o botão "Chamar bots" dentro do jogo.
 *
 *   node panel-server.js --server http://192.168.1.101:3000
 */

const swarm = require('./swarm');
const config = require('./config');
const { startWebPanel } = require('./panel/web');
const { makeLogger } = require('./lib/logger');

const log = makeLogger('PANEL');

// Não sobe bots automaticamente — o jogo (ou a UI web) chama /api/start
const web = startWebPanel({
  port: process.env.BOTS_PANEL_PORT || 3001,
});

log.info('Aguardando comandos via http://localhost:3001/');

function shutdown() {
  swarm.stop();
  try { web.close(); } catch (_) { /* ignore */ }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
