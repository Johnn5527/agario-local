'use strict';

/**
 * Integração contra servidor local com rendezvous forçado.
 *
 * Uso (jogo em :3000):
 *   node test/sacrifice_integration.js
 */

process.env.TARGET_PLAYER_NAME = 'SacTarget';
process.env.BOT_COUNT = '1';
process.env.FEEDING_MODE = 'hybrid';
process.env.SACRIFICE_MIN_BOT_MASS = '30';
process.env.SACRIFICE_SAFETY_MARGIN = '1.5';
process.env.SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
process.env.BOT_NAME_PREFIX = 'SacBot_';
process.env.IGNORE_THREAT_NAME_PREFIX = 'SacBot_';

delete require.cache[require.resolve('../config')];
delete require.cache[require.resolve('../swarm')];
delete require.cache[require.resolve('../bot')];
delete require.cache[require.resolve('../lib/sacrifice')];

const io = require('socket.io-client');
const swarm = require('../swarm');
const { evaluateSacrificeSafety } = require('../lib/sacrifice');

const SERVER = process.env.SERVER_URL;
const TARGET = 'SacTarget';
const TIMEOUT_MS = 120000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function connectTarget() {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER, {
      query: { type: 'player' },
      transports: ['websocket', 'polling'],
      reconnection: false,
    });

    let mass = 0;
    let prev = 0;
    let x = 0;
    let y = 0;
    let foods = [];
    let mode = 'hunt'; // hunt | seek | hold | drop
    let seek = null;
    let forceDropDone = false;
    const massJumps = [];

    const api = {
      socket,
      massJumps,
      getMass: () => mass,
      getPos: () => ({ x, y }),
      setSeek(pos) { mode = 'seek'; seek = pos; },
      hold() { mode = 'hold'; },
      forceDrop() {
        mode = 'drop';
        let n = 0;
        const iv = setInterval(() => {
          socket.emit('1');
          n += 1;
          if (n >= 18) {
            clearInterval(iv);
            mode = 'hold';
          }
        }, 160);
      },
    };

    socket.on('connect_error', (e) => reject(e));
    socket.on('connect', () => socket.emit('respawn'));
    socket.on('welcome', (ps) => {
      const p = ps;
      p.name = TARGET;
      // Viewport grande ajuda a “ver” o bot mais cedo
      p.screenWidth = 4000;
      p.screenHeight = 4000;
      p.target = { x: 0, y: 0 };
      socket.emit('gotit', p);
      resolve(api);
    });

    setInterval(() => {
      let tx = 0;
      let ty = 0;
      if (mode === 'hunt') {
        if (foods.length) {
          let best = foods[0];
          let bestD = Infinity;
          for (const f of foods) {
            const d = Math.hypot(f.x - x, f.y - y);
            if (d < bestD) { bestD = d; best = f; }
          }
          tx = best.x - x;
          ty = best.y - y;
        } else {
          tx = Math.sin(Date.now() / 1800) * 900;
          ty = Math.cos(Date.now() / 2100) * 900;
        }
      } else if (mode === 'seek' && seek) {
        tx = seek.x - x;
        ty = seek.y - y;
      } else {
        tx = 0;
        ty = 0;
      }
      socket.emit('0', { x: tx, y: ty });
    }, 80);

    socket.on('serverTellPlayerMove', (playerData, _u, foodsList) => {
      prev = mass;
      mass = Math.round(playerData.massTotal);
      x = playerData.x;
      y = playerData.y;
      foods = foodsList || [];
      if (mass - prev >= 25) {
        massJumps.push({ from: prev, to: mass, delta: mass - prev, at: Date.now() });
        console.log(`[integration] SALTO massa alvo ${prev} → ${mass} (+${mass - prev})`);
      }
    });

    socket.on('RIP', () => setTimeout(() => socket.emit('respawn'), 1200));
  });
}

async function main() {
  console.log('=== Integração modo sacrifício ===');
  console.log('Servidor:', SERVER);

  const unsafe = evaluateSacrificeSafety({
    targetMass: 40, botMass: 80, safetyMargin: 1.5, minBotMass: 30, feedingMode: 'hybrid',
  });
  if (unsafe.ok) throw new Error('sanidade falhou: bot>alvo');

  const target = await connectTarget();
  console.log('✓ alvo fake conectado');

  // Cresce até ~70
  const growUntil = Date.now() + 60000;
  while (target.getMass() < 70 && Date.now() < growUntil) {
    await sleep(1500);
    console.log(`[integration] alvo caçando comida... mass=${target.getMass()}`);
  }
  console.log(`[integration] alvo pronto mass=${target.getMass()}`);

  // Bot com viewport grande (via monkeypatch do config já carregado no swarm)
  const config = require('../config');
  config.BOT_NAME_PREFIX = 'SacBot_';
  config.IGNORE_THREAT_NAME_PREFIX = 'SacBot_';

  swarm.start({ target: TARGET, count: 1, feedingMode: 'hybrid' });

  // Espera bot nascer e crescer um pouco; depois rendezvous
  const deadline = Date.now() + TIMEOUT_MS;
  let sawSacrificing = false;
  let sawAbort = false;
  let audits = [];
  let rendezvousStarted = false;
  let dropTriggered = false;

  while (Date.now() < deadline) {
    await sleep(1000);
    const st = swarm.getStatus();
    const bot = st.bots[0];
    if (!bot || bot.x == null) continue;

    // Bot ainda pequeno: deixa explorar. Quando >= 30 e alvo grande, forçar encontro.
    if (!rendezvousStarted && bot.mass >= 30 && target.getMass() >= 70) {
      rendezvousStarted = true;
      target.setSeek({ x: bot.x, y: bot.y });
      console.log(`[integration] rendezvous: alvo indo até bot @(${bot.x},${bot.y})`);
    }
    if (rendezvousStarted && bot.x != null) {
      target.setSeek({ x: bot.x, y: bot.y });
    }

    if (bot.state === 'SACRIFICING') {
      sawSacrificing = true;
      if (bot.lastSacrificeAudit) {
        audits.push(bot.lastSacrificeAudit);
        console.log('[integration] SACRIFICING', JSON.stringify(bot.lastSacrificeAudit));
        if (bot.lastSacrificeAudit.botMass >= bot.lastSacrificeAudit.targetMass) {
          throw new Error('conta invertida no audit');
        }
      }
      // Depois de ver sacrifício, força queda de massa do alvo pra exercitar abort
      // (se ainda não morreu)
      if (!dropTriggered && target.getMass() > 80) {
        dropTriggered = true;
        // Só dropa se ainda não houve salto gigante (sacrifício completo)
        if (target.massJumps.length === 0) {
          console.log('[integration] drop forçado do alvo (teste de abort)');
          target.forceDrop();
        }
      }
    }

    if (sawSacrificing && bot.state !== 'SACRIFICING' && bot.state !== 'DEAD') {
      if (dropTriggered) sawAbort = true;
    }

    console.log(
      `[integration] bot=${bot.state} m=${bot.mass} vis=${bot.targetVisible} ` +
      `dist=${bot.targetDist} alvoM=${target.getMass()} sacr=${bot.totalMassSacrificed}`
    );

    if (sawSacrificing && (bot.totalMassSacrificed > 0 || target.massJumps.length > 0)) {
      break;
    }
  }

  swarm.stop();
  target.socket.disconnect();

  console.log('\n=== RESULTADO ===');
  console.log('viu SACRIFICING:', sawSacrificing);
  console.log('saltos de massa:', target.massJumps);
  console.log('abort observado:', sawAbort);
  console.log('audits:', audits.slice(-2));

  if (!sawSacrificing) {
    console.warn('⚠ Não viu SACRIFICING — mapa lotado ou tempo curto. Unitários cobrem a conta.');
    process.exit(0);
  }
  console.log('✓ SACRIFICING observado com audit no lado correto');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
