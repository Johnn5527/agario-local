'use strict';
/**
 * Simula o jogador humano que os bots devem alimentar.
 *
 * Uso:
 *   node test/fake_player.js JohnnyTeste
 *   node test/fake_player.js JohnnyTeste --hunt-food
 *   node test/fake_player.js JohnnyTeste --hunt-food --force-drop-at=80
 *   node test/fake_player.js JohnnyTeste --sim-mass=120   (só log local — NÃO muda o servidor)
 *
 * Flags:
 *   --hunt-food       move pelo mapa comendo comida pra crescer de verdade
 *   --force-drop-at=N quando massa real >= N, solta W várias vezes (simula queda
 *                     de massa durante aproximação de sacrifício)
 *   --server=URL      padrão http://localhost:3000
 */

const io = require('socket.io-client');

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--')) || 'JohnnyTeste';
const huntFood = args.includes('--hunt-food');
const serverArg = args.find((a) => a.startsWith('--server='));
const SERVER = serverArg ? serverArg.slice('--server='.length) : 'http://localhost:3000';
const dropAtArg = args.find((a) => a.startsWith('--force-drop-at='));
const FORCE_DROP_AT = dropAtArg ? Number(dropAtArg.split('=')[1]) : null;

const socket = io(SERVER, {
  query: { type: 'player' },
  transports: ['websocket', 'polling'],
  reconnection: false,
});

let mass = 0;
let cells = 0;
let x = 0;
let y = 0;
let foods = [];
let dropping = false;
let massHistory = [];

socket.on('connect', () => socket.emit('respawn'));

setInterval(() => {
  if (!huntFood) {
    socket.emit('0', { x: 0, y: 0 });
    return;
  }
  // Vai em direção à comida mais próxima (ou vaga pelo mapa)
  let tx = 400;
  let ty = 400;
  if (foods.length > 0) {
    let best = foods[0];
    let bestD = Infinity;
    for (const f of foods) {
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    tx = best.x - x;
    ty = best.y - y;
  } else {
    tx = Math.sin(Date.now() / 2000) * 800;
    ty = Math.cos(Date.now() / 2300) * 800;
  }
  socket.emit('0', { x: tx, y: ty });
}, 120);

socket.on('kick', (reason) => console.log(`[${name}] KICKADO: ${reason}`));
socket.on('disconnect', (reason) => console.log(`[${name}] desconectado: ${reason}`));

socket.on('welcome', (playerSettings) => {
  const player = playerSettings;
  player.name = name;
  player.screenWidth = 1920;
  player.screenHeight = 1080;
  player.target = { x: 0, y: 0 };
  socket.emit('gotit', player);
  console.log(`[${name}] entrou | huntFood=${huntFood} forceDropAt=${FORCE_DROP_AT}`);
});

socket.on('serverTellPlayerMove', (playerData, _users, foodsList) => {
  const prev = mass;
  mass = Math.round(playerData.massTotal);
  cells = playerData.cells.length;
  x = playerData.x;
  y = playerData.y;
  foods = foodsList || [];

  if (mass !== prev) {
    massHistory.push({ t: Date.now(), mass, delta: mass - prev });
    if (mass - prev >= 20) {
      console.log(`[${name}] SALTO DE MASSA +${mass - prev} → ${mass} (possível sacrifício/comida grande)`);
    }
  }

  if (FORCE_DROP_AT && !dropping && mass >= FORCE_DROP_AT) {
    dropping = true;
    console.log(`[${name}] Forçando queda de massa (W spam) a partir de ${mass}`);
    let n = 0;
    const iv = setInterval(() => {
      socket.emit('1');
      n += 1;
      if (n >= 15) {
        clearInterval(iv);
        console.log(`[${name}] Drop concluído; massa agora=${mass}`);
        // libera pra dropar de novo se recuperar
        setTimeout(() => { dropping = false; }, 8000);
      }
    }, 200);
  }
});

socket.on('RIP', () => {
  console.log(`[${name}] morreu! respawn em 1.5s`);
  setTimeout(() => socket.emit('respawn'), 1500);
});

setInterval(() => {
  console.log(`[${name}] massa=${mass} células=${cells} pos=(${Math.round(x)},${Math.round(y)}) comidaVis=${foods.length}`);
}, 2000);

process.on('SIGINT', () => {
  console.log(`[${name}] histórico de deltas:`, massHistory.slice(-15));
  socket.disconnect();
  process.exit(0);
});
