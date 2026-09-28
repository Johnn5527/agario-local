'use strict';

const readline = require('readline');
const { makeLogger } = require('../lib/logger');

const log = makeLogger('TERM');

const STATE_MARK = {
  CONNECTING: '·',
  EXPLORING: '○',
  APPROACHING: '→',
  PREPARING: '…',
  FEEDING: 'W',
  SACRIFICING: '★',
  EVADING: '!',
  DEAD: 'x',
};

const HELP = `
Atalhos do painel (terminal):
  p          pausar / retomar enxame inteiro
  + / -      adicionar / remover um bot
  t          trocar TARGET_PLAYER_NAME
  m          trocar FEEDING_MODE (trickle|sacrifice|hybrid)
  d          ajustar distâncias (approach/feed/safe)
  b          definir BOT_COUNT exato
  s          estatísticas agregadas + eventos
  l          alternar painel resumido/detalhado
  i <n|nome> selecionar bot (ex: i 0  ou  i Feeder_2)
  e          force explore no bot selecionado
  f          freeze/unfreeze no bot selecionado
  x          force sacrifice no bot selecionado
  r          soft-reconnect no bot selecionado
  ?          esta ajuda
  q          encerrar com segurança
`.trim();

function startTerminal(swarm, opts = {}) {
  const intervalMs = opts.intervalMs || 4000;
  let detailed = false;
  let selected = 0;
  let refreshTimer = null;
  let prompting = false;

  if (!process.stdin.isTTY) {
    log.warn('stdin não é TTY — painel interativo desativado (use o painel web).');
    refreshTimer = setInterval(() => printPanel(swarm, detailed, selected), intervalMs);
    return { stop: () => clearInterval(refreshTimer) };
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const ask = (question) => new Promise((resolve) => {
    prompting = true;
    process.stdin.setRawMode(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      process.stdin.setRawMode(true);
      process.stdin.resume();
      prompting = false;
      resolve(answer);
    });
  });

  const printPanel = () => {
    if (prompting) return;
    const s = swarm.getStatus();
    const agg = s.aggregates || {};
    console.log('\n========== PAINEL BOTS ==========');
    console.log(
      `alvo=${s.targetName} | modo=${s.feedingMode} | bots=${s.botCount} | ` +
      `${s.paused ? 'PAUSADO' : 'ATIVO'} | entregue≈${agg.estimatedMassDelivered || 0}`
    );
    console.log(`selecionado: [#${selected}] ${s.bots[selected] ? s.bots[selected].name : '-'}`);
    for (let i = 0; i < s.bots.length; i++) {
      const r = s.bots[i];
      const mark = STATE_MARK[r.state] || '?';
      const flags = `${r.paused ? 'P' : ''}${r.frozen ? 'F' : ''}` || '-';
      const sel = i === selected ? '>' : ' ';
      if (!detailed) {
        console.log(
          `${sel}${mark} [#${i}] ${r.name.padEnd(12)} ${String(r.state).padEnd(11)} ` +
          `m=${String(r.mass).padEnd(4)} dist=${String(r.targetDist ?? '-').padEnd(5)} [${flags}]`
        );
      } else {
        console.log(
          `${sel}${mark} [#${i}] ${r.name} | conn=${r.connected} vivo=${r.alive} estado=${r.state} ` +
          `massa=${r.mass} cél=${r.cells} alvoVis=${r.targetVisible} dist=${r.targetDist ?? '-'} ` +
          `comida=${r.visibleFood} sacr≈${r.totalMassSacrificed} mortes=${r.deaths} ` +
          `ms→feed=${r.msToFeedReady ?? '-'} [${flags}]`
        );
        if (r.stateHistory && r.stateHistory.length) {
          const hist = r.stateHistory.map((h) => h.state).join('→');
          console.log(`    hist: ${hist}`);
        }
      }
    }
    console.log('(? ajuda | q sair)');
    console.log('=================================\n');
  };

  const printStats = () => {
    const s = swarm.getStatus();
    const a = s.aggregates || {};
    console.log('\n----- ESTATÍSTICAS -----');
    console.log(`uptime: ${a.uptimeSec}s`);
    console.log(`massa estimada entregue: ${a.estimatedMassDelivered} (W≈${a.trickleMassDelivered} + sacr≈${a.totalMassSacrificed})`);
    console.log(`tempo médio até alimentar: ${a.avgMsToFeedReady != null ? (a.avgMsToFeedReady / 1000).toFixed(1) + 's' : 'n/a'}`);
    console.log(`mortes=${a.deaths} respawns=${a.respawns}`);
    console.log('-- eventos recentes --');
    for (const ev of (s.events || []).slice(-12)) {
      console.log(`  ${ev.at} ${ev.type} ${JSON.stringify(ev.detail).slice(0, 80)}`);
    }
    console.log('------------------------\n');
  };

  refreshTimer = setInterval(printPanel, intervalMs);
  printPanel();
  console.log(HELP);

  const onKey = async (str, key) => {
    if (prompting) return;
    if (key && key.ctrl && key.name === 'c') {
      cleanup();
      swarm.stop();
      process.exit(0);
    }

    try {
      switch (str) {
        case '?':
          console.log(HELP);
          break;
        case 'q':
          cleanup();
          swarm.stop();
          setTimeout(() => process.exit(0), 200);
          break;
        case 'p':
          swarm.togglePause();
          printPanel();
          break;
        case '+':
        case '=':
          swarm.addBot();
          selected = Math.max(0, swarm.getStatus().bots.length - 1);
          printPanel();
          break;
        case '-':
        case '_':
          swarm.removeBot(selected);
          selected = Math.max(0, Math.min(selected, swarm.getStatus().bots.length - 1));
          printPanel();
          break;
        case 'l':
          detailed = !detailed;
          printPanel();
          break;
        case 's':
          printStats();
          break;
        case 't': {
          const name = await ask('Novo TARGET_PLAYER_NAME: ');
          if (name && name.trim()) swarm.setTarget(name.trim());
          printPanel();
          break;
        }
        case 'm': {
          const mode = await ask('FEEDING_MODE (trickle|sacrifice|hybrid): ');
          if (mode && mode.trim()) swarm.setFeedingMode(mode.trim());
          printPanel();
          break;
        }
        case 'b': {
          const n = await ask('BOT_COUNT (0-20): ');
          swarm.setBotCount(Number(n));
          selected = 0;
          printPanel();
          break;
        }
        case 'd': {
          const a = await ask('APPROACH_DISTANCE (enter=manter): ');
          const f = await ask('FEED_DISTANCE (enter=manter): ');
          const s = await ask('MIN_SAFE_DISTANCE (enter=manter): ');
          const patch = {};
          if (a.trim()) patch.APPROACH_DISTANCE = Number(a);
          if (f.trim()) patch.FEED_DISTANCE = Number(f);
          if (s.trim()) patch.MIN_SAFE_DISTANCE = Number(s);
          swarm.patchConfig(patch);
          printPanel();
          break;
        }
        case 'i': {
          const sel = await ask('Selecionar bot (índice ou nome): ');
          if (sel.trim()) {
            selected = swarm.resolveBotIndex(sel.trim());
          }
          printPanel();
          break;
        }
        case 'e':
          swarm.forceExplore(selected);
          printPanel();
          break;
        case 'f': {
          const st = swarm.getStatus();
          const bot = st.bots[selected];
          if (bot) swarm.freezeBot(selected, !bot.frozen);
          printPanel();
          break;
        }
        case 'x':
          swarm.forceSacrifice(selected);
          printPanel();
          break;
        case 'r':
          swarm.reconnectBot(selected);
          printPanel();
          break;
        default:
          break;
      }
    } catch (err) {
      console.log('Erro:', err.message);
    }
  };

  process.stdin.on('keypress', onKey);

  function cleanup() {
    clearInterval(refreshTimer);
    process.stdin.removeListener('keypress', onKey);
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch (_) { /* ignore */ }
    }
  }

  return { stop: cleanup, printPanel };
}

module.exports = { startTerminal, HELP };
