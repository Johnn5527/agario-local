'use strict';

/**
 * Sobe o enxame + painel terminal (atalhos) + painel web (http://localhost:3001).
 *
 *   node index.js --target Johnny --count 4 --mode hybrid
 */

const swarm = require('./swarm');
const config = require('./config');
const { startTerminal } = require('./panel/terminal');
const { startWebPanel } = require('./panel/web');
const { makeLogger } = require('./lib/logger');

const log = makeLogger('MAIN');

swarm.start({
  target: config.TARGET_PLAYER_NAME,
  count: config.BOT_COUNT,
  feedingMode: config.FEEDING_MODE,
});

const web = startWebPanel({ port: process.env.BOTS_PANEL_PORT || 3001 });
const term = startTerminal(swarm, { intervalMs: config.STATUS_LOG_INTERVAL_MS });

log.info('Painel terminal ativo (? = ajuda)');
log.info('Painel web: http://localhost:' + (process.env.BOTS_PANEL_PORT || 3001) + '/');

function shutdown() {
  log.info('Encerrando...');
  try { term.stop(); } catch (_) { /* ignore */ }
  try { web.close(); } catch (_) { /* ignore */ }
  swarm.stop();
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
