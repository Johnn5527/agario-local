'use strict';

/**
 * Teste rápido de forceMerge:
 * conecta, "split" via emit 2 (se massa permitir após boost artificial... 
 * massa inicial 10 não splitta). Em vez disso, verifica o handler
 * respondendo e o método forceMergeAll via /api se disponível.
 *
 * Uso com servidor up:
 *   node scripts/test-force-merge.js
 */

const io = require('socket.io-client');
const SERVER = process.env.SERVER_URL || 'http://localhost:3000';

const socket = io(SERVER, {
  query: { type: 'player' },
  transports: ['websocket'],
  reconnection: false,
});

let cells = 0;
let mass = 0;

socket.on('connect', () => socket.emit('respawn'));
socket.on('welcome', (ps) => {
  const p = ps;
  p.name = 'MergeTester';
  p.screenWidth = 1920;
  p.screenHeight = 1080;
  p.target = { x: 0, y: 0 };
  socket.emit('gotit', p);
  console.log('conectado — caçando comida pra poder dar split...');
});

const hunt = setInterval(() => {
  socket.emit('0', {
    x: Math.sin(Date.now() / 900) * 1200,
    y: Math.cos(Date.now() / 1100) * 1200,
  });
}, 80);

socket.on('serverTellPlayerMove', (pd) => {
  mass = Math.round(pd.massTotal);
  cells = pd.cells.length;
});

let stage = 'grow';
const started = Date.now();

const loop = setInterval(() => {
  console.log(`stage=${stage} mass=${mass} cells=${cells}`);
  if (stage === 'grow' && mass >= 40) {
    socket.emit('2');
    stage = 'waitSplit';
  } else if (stage === 'waitSplit' && cells > 1) {
    console.log('SPLIT ok — disparando forceMerge (Backspace)');
    socket.emit('forceMerge');
    stage = 'waitMerge';
  } else if (stage === 'waitMerge') {
    if (cells === 1) {
      console.log('✓ forceMerge reuniu as células (cells=1, mass=' + mass + ')');
      cleanup(0);
    } else if (Date.now() - started > 60000) {
      console.error('timeout esperando merge');
      cleanup(1);
    }
  } else if (Date.now() - started > 90000) {
    console.error('timeout no grow/split');
    cleanup(1);
  }
}, 500);

function cleanup(code) {
  clearInterval(hunt);
  clearInterval(loop);
  socket.disconnect();
  process.exit(code);
}

socket.on('connect_error', (e) => {
  console.error(e.message);
  process.exit(2);
});
