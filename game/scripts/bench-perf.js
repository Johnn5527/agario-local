'use strict';

/**
 * Benchmark de carga do servidor Agar.io clone.
 * Conecta N bots "burros" (só heartbeat) e coleta /api/perf se disponível,
 * senão estima via tempo entre eventos no lado do cliente.
 *
 * Uso: node scripts/bench-perf.js [0|4|10|20]
 */

const io = require('socket.io-client');
const SERVER = process.env.SERVER_URL || 'http://localhost:3000';
const N = Number(process.argv[2] || 0);
const DURATION_MS = Number(process.argv[3] || 12000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function connectDummy(name) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER, {
      query: { type: 'player' },
      transports: ['websocket'],
      reconnection: false,
    });
    let lastPayload = 0;
    let payloads = [];
    let moveCount = 0;

    socket.on('connect_error', reject);
    socket.on('connect', () => socket.emit('respawn'));
    socket.on('welcome', (ps) => {
      const p = ps;
      p.name = name;
      p.screenWidth = 1920;
      p.screenHeight = 1080;
      p.target = { x: 0, y: 0 };
      socket.emit('gotit', p);
      resolve({
        socket,
        stats: () => ({ moveCount, avgPayload: payloads.length ? payloads.reduce((a, b) => a + b, 0) / payloads.length : 0, payloads }),
      });
    });

    const heartbeat = setInterval(() => {
      socket.emit('0', {
        x: Math.sin(Date.now() / 1000) * 500,
        y: Math.cos(Date.now() / 1100) * 500,
      });
    }, 120);

    socket.on('serverTellPlayerMove', (playerData, users, foods, mass, viruses) => {
      moveCount += 1;
      // estimativa grosseira do tamanho do payload (JSON)
      const approx = JSON.stringify({
        playerData,
        users: users && users.length,
        foods: foods && foods.length,
        mass: mass && mass.length,
        viruses: viruses && viruses.length,
        // amostra: serializa só contagens + 1 food se houver
        sampleFood: foods && foods[0],
        userSample: users && users[0],
      }).length;
      // melhor: stringify listas reais (custo no bench client ok)
      const full = Buffer.byteLength(JSON.stringify([playerData, users, foods, mass, viruses]));
      payloads.push(full);
      lastPayload = full;
    });

    socket.on('disconnect', () => clearInterval(heartbeat));
  });
}

async function main() {
  console.log(`Bench N=${N} server=${SERVER} duration=${DURATION_MS}ms`);

  let perfBefore = null;
  try {
    perfBefore = await fetch(`${SERVER}/api/perf`).then((r) => r.json());
  } catch (_) {
    console.log('(sem /api/perf ainda — medindo só payload no cliente)');
  }

  const bots = [];
  for (let i = 0; i < N; i++) {
    bots.push(await connectDummy(`Bench_${i}_${Date.now() % 10000}`));
    await sleep(50);
  }

  await sleep(DURATION_MS);

  let perfAfter = null;
  try {
    perfAfter = await fetch(`${SERVER}/api/perf`).then((r) => r.json());
  } catch (_) {}

  const sample = bots[0] ? bots[0].stats() : null;
  const allPayloads = bots.flatMap((b) => b.stats().payloads);
  const avgPayload = allPayloads.length
    ? allPayloads.reduce((a, b) => a + b, 0) / allPayloads.length
    : 0;
  const maxPayload = allPayloads.length ? Math.max(...allPayloads) : 0;

  console.log('\n=== RESULTADO ===');
  console.log('bots conectados:', N);
  if (sample) {
    console.log('updates recebidos (1 bot):', sample.moveCount);
    console.log('Hz aparente:', (sample.moveCount / (DURATION_MS / 1000)).toFixed(1));
  }
  console.log('payload médio serverTellPlayerMove:', (avgPayload / 1024).toFixed(2), 'KB');
  console.log('payload máx:', (maxPayload / 1024).toFixed(2), 'KB');
  if (perfAfter) {
    console.log('perf servidor:', JSON.stringify(perfAfter, null, 2));
  }
  if (perfBefore) {
    console.log('perf antes (baseline snapshot):', JSON.stringify(perfBefore.tick || perfBefore));
  }

  for (const b of bots) b.socket.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
