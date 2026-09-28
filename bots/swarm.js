'use strict';

const config = require('./config');
const { FeederBot } = require('./bot');
const { makeLogger } = require('./lib/logger');
const { EventBus } = require('./lib/eventBus');

const log = makeLogger('SWARM');
const bus = new EventBus();

let bots = [];
let running = false;
let paused = false;
let nextBotSerial = 1;
const sacrificeLog = [];
const targetMassSeries = []; // { t, mass } para gráfico
const processStartedAt = Date.now();

function makeHooks() {
  return {
    onSacrificeAttempt(ev) {
      bus.emit('sacrifice_attempt', ev);
      log.info(`AUDIT sacrifício tentado por ${ev.name}`, JSON.stringify(ev.audit));
    },
    onSacrificeAbort(ev) {
      bus.emit('sacrifice_abort', { name: ev.name, reason: ev.reason });
      log.warn(`AUDIT sacrifício abortado ${ev.name}: ${ev.reason}`);
    },
    onSacrificeComplete(ev) {
      sacrificeLog.push(ev);
      bus.emit('sacrifice_complete', ev);
      log.info(`HISTÓRICO sacrifício: ${ev.name} entregou ~${Math.round(ev.mass)} em ${ev.at}`);
    },
    onDeath(ev) {
      bus.emit('death', ev);
    },
    onStateChange(ev) {
      bus.emit('state', ev);
    },
    onFeed(ev) {
      bus.emit('feed', ev);
    },
    onTargetMass(ev) {
      targetMassSeries.push({ t: Date.now(), mass: ev.mass });
      if (targetMassSeries.length > 120) targetMassSeries.shift();
    },
  };
}

function reindexSweep() {
  const size = Math.max(1, bots.length);
  bots.forEach((bot, i) => {
    bot.swarmIndex = i;
    bot.swarmSize = size;
    bot.rebalanceSweep();
  });
  config.BOT_COUNT = bots.length;
}

function createBot(name) {
  const bot = new FeederBot(
    name,
    config,
    bots.length,
    Math.max(1, bots.length + 1),
    makeHooks()
  );
  if (paused) bot.setPaused(true);
  return bot;
}

function getAggregates() {
  const statuses = bots.map((b) => b.getStatus());
  const deaths = statuses.reduce((s, b) => s + (b.deaths || 0), 0);
  const respawns = statuses.reduce((s, b) => s + (b.respawns || 0), 0);
  const feedMs = statuses
    .map((b) => b.msToFeedReady)
    .filter((v) => typeof v === 'number' && v > 0);
  const avgMsToFeed = feedMs.length
    ? Math.round(feedMs.reduce((a, b) => a + b, 0) / feedMs.length)
    : null;

  const trickleMass = statuses.reduce((s, b) => s + (b.trickleMassDelivered || 0), 0);
  const sacrificeMass = statuses.reduce((s, b) => s + (b.totalMassSacrificed || 0), 0);

  return {
    uptimeSec: Math.round((Date.now() - processStartedAt) / 1000),
    deaths,
    respawns,
    avgMsToFeedReady: avgMsToFeed,
    trickleMassDelivered: Math.round(trickleMass),
    totalMassSacrificed: Math.round(sacrificeMass),
    estimatedMassDelivered: Math.round(trickleMass + sacrificeMass),
    targetMassSeries: targetMassSeries.slice(),
  };
}

function getStatus() {
  const botStatuses = bots.map((b) => b.getStatus());
  return {
    running,
    paused,
    targetName: config.TARGET_PLAYER_NAME,
    botCount: bots.length,
    feedingMode: config.FEEDING_MODE,
    config: {
      TARGET_PLAYER_NAME: config.TARGET_PLAYER_NAME,
      BOT_COUNT: bots.length,
      FEEDING_MODE: config.FEEDING_MODE,
      SACRIFICE_SAFETY_MARGIN: config.SACRIFICE_SAFETY_MARGIN,
      SACRIFICE_MIN_BOT_MASS: config.SACRIFICE_MIN_BOT_MASS,
      APPROACH_DISTANCE: config.APPROACH_DISTANCE,
      FEED_DISTANCE: config.FEED_DISTANCE,
      MIN_SAFE_DISTANCE: config.MIN_SAFE_DISTANCE,
      SERVER_URL: config.SERVER_URL,
    },
    bots: botStatuses,
    sacrificeLog: sacrificeLog.slice(-30),
    events: bus.recent(30),
    aggregates: getAggregates(),
    totalMassSacrificed: botStatuses.reduce((s, b) => s + (b.totalMassSacrificed || 0), 0),
  };
}

function start({ target, count, serverUrl, feedingMode } = {}) {
  stop();

  if (target) config.TARGET_PLAYER_NAME = String(target).trim();
  if (serverUrl) config.SERVER_URL = serverUrl;
  if (feedingMode) config.FEEDING_MODE = String(feedingMode).toLowerCase();

  const n = Math.max(1, Math.min(20, Number(count) || config.BOT_COUNT || 4));
  config.BOT_COUNT = n;
  running = true;
  paused = false;
  bots = [];
  nextBotSerial = 1;

  log.info(`Subindo ${n} bots para alimentar "${config.TARGET_PLAYER_NAME}"`);
  log.info(`Servidor: ${config.SERVER_URL} | modo: ${config.FEEDING_MODE}`);
  bus.emit('swarm_start', { count: n, target: config.TARGET_PLAYER_NAME });

  for (let i = 0; i < n; i++) {
    const name = `${config.BOT_NAME_PREFIX}${nextBotSerial++}`;
    const bot = createBot(name);
    bots.push(bot);
  }
  reindexSweep();

  bots.forEach((bot, i) => {
    setTimeout(() => {
      if (running && bots.includes(bot)) bot.start();
    }, (i + 1) * (config.BOT_START_STAGGER_MS || 80));
  });

  return getStatus();
}

function stop() {
  log.info('Encerrando bots...');
  running = false;
  paused = false;
  bots.forEach((b) => {
    try { b.stop(); } catch (_) { /* ignore */ }
  });
  bots = [];
  bus.emit('swarm_stop', {});
  return getStatus();
}

function setPaused(value) {
  paused = !!value;
  bots.forEach((b) => b.setPaused(paused));
  bus.emit(paused ? 'swarm_pause' : 'swarm_resume', {});
  log.info(paused ? 'Enxame PAUSADO' : 'Enxame RETOMADO');
  return getStatus();
}

function togglePause() {
  return setPaused(!paused);
}

function addBot() {
  if (!running) {
    return start({ count: 1 });
  }
  if (bots.length >= 20) {
    throw new Error('Limite de 20 bots');
  }
  const name = `${config.BOT_NAME_PREFIX}${nextBotSerial++}`;
  const bot = createBot(name);
  bots.push(bot);
  reindexSweep();
  bot.start();
  bus.emit('bot_add', { name });
  log.info(`+ bot ${name} (total=${bots.length})`);
  return getStatus();
}

function removeBot(selector) {
  if (!bots.length) return getStatus();
  let idx = bots.length - 1;
  if (selector != null && selector !== '') {
    idx = resolveBotIndex(selector);
  }
  const [bot] = bots.splice(idx, 1);
  if (bot) {
    try { bot.stop(); } catch (_) { /* ignore */ }
    bus.emit('bot_remove', { name: bot.name });
    log.info(`- bot ${bot.name} (total=${bots.length})`);
  }
  reindexSweep();
  if (!bots.length) {
    running = false;
  }
  return getStatus();
}

function setBotCount(n) {
  n = Math.max(0, Math.min(20, Number(n)));
  while (bots.length < n) addBot();
  while (bots.length > n) removeBot();
  return getStatus();
}

function setTarget(name) {
  const next = String(name || '').trim();
  if (!next) throw new Error('Nome vazio');
  config.TARGET_PLAYER_NAME = next;
  bus.emit('config', { TARGET_PLAYER_NAME: next });
  log.info(`Alvo agora: ${next}`);
  return getStatus();
}

function setFeedingMode(mode) {
  const m = String(mode || '').toLowerCase();
  if (!['trickle', 'sacrifice', 'hybrid'].includes(m)) {
    throw new Error('Modo inválido (trickle|sacrifice|hybrid)');
  }
  config.FEEDING_MODE = m;
  bus.emit('config', { FEEDING_MODE: m });
  log.info(`FEEDING_MODE=${m}`);
  return getStatus();
}

function patchConfig(patch = {}) {
  const allowed = [
    'TARGET_PLAYER_NAME',
    'FEEDING_MODE',
    'SACRIFICE_SAFETY_MARGIN',
    'SACRIFICE_MIN_BOT_MASS',
    'APPROACH_DISTANCE',
    'FEED_DISTANCE',
    'MIN_SAFE_DISTANCE',
    'THREAT_SCAN_RADIUS',
    'FLEE_DISTANCE',
  ];
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    if (key === 'TARGET_PLAYER_NAME') {
      setTarget(patch[key]);
      continue;
    }
    if (key === 'FEEDING_MODE') {
      setFeedingMode(patch[key]);
      continue;
    }
    const num = Number(patch[key]);
    if (Number.isNaN(num)) continue;
    config[key] = num;
  }
  if (patch.BOT_COUNT != null) setBotCount(patch.BOT_COUNT);
  bus.emit('config', patch);
  return getStatus();
}

function resolveBotIndex(selector) {
  if (typeof selector === 'number' && !Number.isNaN(selector)) {
    const i = Number(selector);
    if (i < 0 || i >= bots.length) throw new Error(`Índice inválido: ${i}`);
    return i;
  }
  const s = String(selector);
  if (/^\d+$/.test(s)) {
    const i = Number(s);
    if (i < 0 || i >= bots.length) throw new Error(`Índice inválido: ${i}`);
    return i;
  }
  const i = bots.findIndex((b) => b.name.toLowerCase() === s.toLowerCase());
  if (i < 0) throw new Error(`Bot não encontrado: ${s}`);
  return i;
}

function getBot(selector) {
  return bots[resolveBotIndex(selector)];
}

function freezeBot(selector, frozen = true) {
  const bot = getBot(selector);
  bot.setFrozen(!!frozen);
  bus.emit(frozen ? 'bot_freeze' : 'bot_unfreeze', { name: bot.name });
  log.info(`${frozen ? 'Congelado' : 'Descongelado'}: ${bot.name}`);
  return getStatus();
}

function forceExplore(selector) {
  const bot = getBot(selector);
  bot.resetSweep();
  bus.emit('bot_force_explore', { name: bot.name });
  log.info(`Re-explore: ${bot.name}`);
  return getStatus();
}

function forceSacrifice(selector) {
  const bot = getBot(selector);
  bot.forceSacrificeOnce();
  bus.emit('bot_force_sacrifice', { name: bot.name });
  log.info(`Force sacrifice: ${bot.name}`);
  return getStatus();
}

function reconnectBot(selector) {
  const bot = getBot(selector);
  bot.softReconnect();
  bus.emit('bot_reconnect', { name: bot.name });
  log.info(`Reconnect: ${bot.name}`);
  return getStatus();
}

module.exports = {
  start,
  stop,
  getStatus,
  getSacrificeLog: () => sacrificeLog.slice(),
  setPaused,
  togglePause,
  addBot,
  removeBot,
  setBotCount,
  setTarget,
  setFeedingMode,
  patchConfig,
  freezeBot,
  forceExplore,
  forceSacrifice,
  reconnectBot,
  resolveBotIndex,
  bus,
  isRunning: () => running,
  isPaused: () => paused,
};
