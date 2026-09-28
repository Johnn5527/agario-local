'use strict';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--server' || a === '-s') {
      out.server = argv[++i];
    } else if (a.startsWith('--server=')) {
      out.server = a.slice('--server='.length);
    } else if (a === '--target' || a === '-t') {
      out.target = argv[++i];
    } else if (a.startsWith('--target=')) {
      out.target = a.slice('--target='.length);
    } else if (a === '--count' || a === '-c') {
      out.count = Number(argv[++i]);
    } else if (a.startsWith('--count=')) {
      out.count = Number(a.slice('--count='.length));
    } else if (a === '--mode' || a === '-m') {
      out.mode = argv[++i];
    } else if (a.startsWith('--mode=')) {
      out.mode = a.slice('--mode='.length);
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

const cli = parseArgs(process.argv.slice(2));

if (cli.help) {
  console.log(`
Uso:
  node index.js [--server URL] [--target NOME] [--count N] [--mode hybrid|trickle|sacrifice]
  node panel-server.js [--server URL] [--mode hybrid]

Variáveis de ambiente:
  SERVER_URL / AGARIO_SERVER_URL
  TARGET_PLAYER_NAME
  BOT_COUNT
  FEEDING_MODE
  BOTS_PANEL_PORT
`);
  process.exit(0);
}

const { SERVER_EAT_MASS_RATIO_EQUIV } = require('./lib/sacrifice');

module.exports = {
  SERVER_URL:
    cli.server ||
    process.env.SERVER_URL ||
    process.env.AGARIO_SERVER_URL ||
    'http://localhost:3000',

  TARGET_PLAYER_NAME:
    cli.target ||
    process.env.TARGET_PLAYER_NAME ||
    'Johnny',

  BOT_COUNT: Number(cli.count || process.env.BOT_COUNT || 4),

  BOT_NAME_PREFIX: 'Feeder_',

  // --- Alimentação ---
  // trickle = só W | sacrifice = só se entregar | hybrid = decide por tick
  FEEDING_MODE: (cli.mode || process.env.FEEDING_MODE || 'hybrid').toLowerCase(),

  /**
   * Piso da regra PvP deste clone = 1.0 (contenção geométrica, não 1.25).
   * Ver comentário em lib/sacrifice.js e game/src/server/map/player.js
   * Cell.checkWhoAteWho (bInA).
   */
  SERVER_EAT_MASS_RATIO: SERVER_EAT_MASS_RATIO_EQUIV,

  // Folga sobre a razão do servidor. NÃO baixe sem entender a regra real.
  SACRIFICE_SAFETY_MARGIN: Number(process.env.SACRIFICE_SAFETY_MARGIN || 1.5),

  // Abaixo disso, trickle/crescer é melhor que se sacrificar
  SACRIFICE_MIN_BOT_MASS: Number(process.env.SACRIFICE_MIN_BOT_MASS || 40),

  DEFAULT_PLAYER_MASS: 10,
  FIRE_FOOD_MASS: 20,

  get MIN_FEED_CELL_MASS() {
    return this.DEFAULT_PLAYER_MASS + this.FIRE_FOOD_MASS;
  },

  get MIN_MASS_TO_SPLIT_FEED() {
    return this.MIN_FEED_CELL_MASS * 2.2;
  },

  APPROACH_DISTANCE: 260,
  FEED_DISTANCE: 160,
  MIN_SAFE_DISTANCE: 45,
  THREAT_SCAN_RADIUS: 500,
  THREAT_MASS_RATIO: 1.15,
  FLEE_DISTANCE: 300,

  TICK_MS: Number(process.env.BOT_TICK_MS || 150),
  FEED_COOLDOWN_MS: 220,
  RESPAWN_DELAY_MS: 1500,
  RECONNECT_BASE_DELAY_MS: 1000,
  RECONNECT_MAX_DELAY_MS: 15000,
  BOT_START_STAGGER_MS: Number(process.env.BOT_START_STAGGER_MS || 80),

  EXPLORE_CELL_WIDTH: 1600,
  EXPLORE_CELL_HEIGHT: 900,
  EXPLORE_CELL_REACHED_DIST: 150,
  EXPLORE_STUCK_TIMEOUT_MS: 7000,

  // Prefixo de nome ignorado como ameaça (bots não fogem uns dos outros)
  IGNORE_THREAT_NAME_PREFIX: process.env.IGNORE_THREAT_NAME_PREFIX || 'Feeder_',

  // Viewport do bot (afeta o que o servidor considera "visível")
  BOT_SCREEN_WIDTH: Number(process.env.BOT_SCREEN_WIDTH || 1920),
  BOT_SCREEN_HEIGHT: Number(process.env.BOT_SCREEN_HEIGHT || 1080),

  STATUS_LOG_INTERVAL_MS: 4000,
};
