/*jslint bitwise: true, node: true */
'use strict';

const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});
const SAT = require('sat');

const gameLogic = require('./game-logic');
const loggingRepositry = require('./repositories/logging-repository');
const chatRepository = require('./repositories/chat-repository');
const config = require('../../config');
const util = require('./lib/util');
const mapUtils = require('./map/map');
const {getPosition} = require("./lib/entityUtils");
const { printLanInvite } = require('./lib/lan');
const { SpatialGrid } = require('./lib/spatialGrid');

let map = new mapUtils.Map(config);

let sockets = {};
let spectators = [];
const INIT_MASS_LOG = util.mathLog(config.defaultPlayerMass, config.slowBase);

let leaderboard = [];
let leaderboardChanged = false;

const Vector = SAT.Vector;

// Grades espaciais (comida + jogadores) — cellSize configurável
const SPATIAL_CELL = config.spatialCellSize || 200;
const foodGrid = new SpatialGrid(config.gameWidth, config.gameHeight, SPATIAL_CELL);
const massGrid = new SpatialGrid(config.gameWidth, config.gameHeight, SPATIAL_CELL);
const virusGrid = new SpatialGrid(config.gameWidth, config.gameHeight, SPATIAL_CELL);
const playerGrid = new SpatialGrid(config.gameWidth, config.gameHeight, SPATIAL_CELL);
const _queryBuf = [];

const perf = {
    windowStartedAt: Date.now(),
    tickSamples: [],
    sendSamples: [],
    foodIndexScans: 0,
    playerPairChecks: 0,
    lastTickMs: 0,
    lastSendMs: 0,
};

function pushSample(arr, ms) {
    arr.push(ms);
    if (arr.length > 240) arr.shift();
}

function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function rebuildEntityGrid(grid, data) {
    grid.clear();
    for (let i = 0; i < data.length; i++) {
        grid.insert(data[i], i);
    }
}

app.use(express.static(__dirname + '/../client'));

app.get('/api/stats', function (req, res) {
    res.json({
        players: map.players.data.length,
        spectators: spectators.length,
        food: map.food.data.length,
    });
});

function isFeederName(name) {
    const prefix = config.feederNamePrefix || 'Feeder_';
    return typeof name === 'string' && name.indexOf(prefix) === 0;
}

function removePlayerAt(index) {
    const p = map.players.data[index];
    if (!p) return;
    const sock = sockets[p.id];
    if (sock) {
        try { sock.emit('kick', 'Removido do mapa'); sock.disconnect(); } catch (_) { /* ignore */ }
    }
    delete sockets[p.id];
    map.players.removePlayerByIndex(index);
}

/** Feeders órfãos (sem socket) ou todos os Feeder_* — limpa o mapa sem derrubar humanos. */
app.post('/api/clear-feeders', function (req, res) {
    let removed = 0;
    for (let i = map.players.data.length - 1; i >= 0; i--) {
        const p = map.players.data[i];
        if (isFeederName(p.name) || !sockets[p.id]) {
            removePlayerAt(i);
            removed++;
        }
    }
    console.log('[INFO] clear-feeders: removidos=' + removed + ' restam=' + map.players.data.length);
    res.json({ removed, players: map.players.data.length });
});

app.get('/api/perf', function (req, res) {
    const ticks = perf.tickSamples.slice();
    const sends = perf.sendSamples.slice();
    res.json({
        players: map.players.data.length,
        food: map.food.data.length,
        networkUpdateFactor: config.networkUpdateFactor,
        spatialCellSize: SPATIAL_CELL,
        tickGame: {
            avgMs: Number(avg(ticks).toFixed(3)),
            maxMs: ticks.length ? Number(Math.max(...ticks).toFixed(3)) : 0,
            lastMs: Number(perf.lastTickMs.toFixed(3)),
            samples: ticks.length,
            budgetMs: Number((1000 / 60).toFixed(2)),
        },
        sendUpdates: {
            avgMs: Number(avg(sends).toFixed(3)),
            maxMs: sends.length ? Number(Math.max(...sends).toFixed(3)) : 0,
            lastMs: Number(perf.lastSendMs.toFixed(3)),
        },
        lastWindow: {
            foodIndexScans: perf.foodIndexScans,
            playerPairChecks: perf.playerPairChecks,
        },
    });
});

io.on('connection', function (socket) {
    let type = socket.handshake.query.type;
    console.log('User has connected: ', type);
    switch (type) {
        case 'player':
            addPlayer(socket);
            break;
        case 'spectator':
            addSpectator(socket);
            break;
        default:
            console.log('Unknown user type, not doing anything.');
    }
});

function clampStartMass(requested) {
    const min = config.minStartMass || config.defaultPlayerMass || 10;
    const max = config.maxStartMass || 5000;
    const n = Number(requested);
    if (!Number.isFinite(n)) return config.defaultPlayerMass;
    return Math.max(min, Math.min(max, Math.round(n)));
}

function generateSpawnpoint(mass) {
    let radius = util.massToRadius(mass || config.defaultPlayerMass);
    return getPosition(config.newPlayerInitialPosition === 'farthest', radius, map.players.data)
}


const addPlayer = (socket) => {
    var currentPlayer = new mapUtils.playerUtils.Player(socket.id);

    socket.on('gotit', function (clientPlayerData) {
        console.log('[INFO] Player ' + clientPlayerData.name + ' connecting!');
        const startMass = clampStartMass(clientPlayerData && clientPlayerData.startMass);
        currentPlayer.init(generateSpawnpoint(startMass), startMass);

        if (map.players.findIndexByID(socket.id) > -1) {
            console.log('[INFO] Player ID is already connected, kicking.');
            socket.disconnect();
        } else if (!util.validNick(clientPlayerData.name)) {
            socket.emit('kick', 'Invalid username.');
            socket.disconnect();
        } else {
            console.log('[INFO] Player ' + clientPlayerData.name + ' connected!');
            sockets[socket.id] = socket;

            const sanitizedName = clientPlayerData.name.replace(/(<([^>]+)>)/ig, '');
            clientPlayerData.name = sanitizedName;

            currentPlayer.clientProvidedData(clientPlayerData);
            map.players.pushNew(currentPlayer);
            io.emit('playerJoin', { name: currentPlayer.name });
            console.log('Total players: ' + map.players.data.length);
        }

    });

    socket.on('pingcheck', () => {
        socket.emit('pongcheck');
    });

    socket.on('windowResized', (data) => {
        currentPlayer.screenWidth = data.screenWidth;
        currentPlayer.screenHeight = data.screenHeight;
    });

    socket.on('respawn', () => {
        map.players.removePlayerByID(currentPlayer.id);
        socket.emit('welcome', currentPlayer, {
            width: config.gameWidth,
            height: config.gameHeight
        });
        console.log('[INFO] User ' + currentPlayer.name + ' has respawned');
    });

    socket.on('disconnect', () => {
        map.players.removePlayerByID(currentPlayer.id);
        console.log('[INFO] User ' + currentPlayer.name + ' has disconnected');
        socket.broadcast.emit('playerDisconnect', { name: currentPlayer.name });
    });

    socket.on('playerChat', (data) => {
        var _sender = data.sender.replace(/(<([^>]+)>)/ig, '');
        var _message = data.message.replace(/(<([^>]+)>)/ig, '');

        if (config.logChat === 1) {
            console.log('[CHAT] [' + (new Date()).getHours() + ':' + (new Date()).getMinutes() + '] ' + _sender + ': ' + _message);
        }

        socket.broadcast.emit('serverSendPlayerChat', {
            sender: currentPlayer.name,
            message: _message.substring(0, 35)
        });

        chatRepository.logChatMessage(_sender, _message, currentPlayer.ipAddress)
            .catch((err) => console.error("Error when attempting to log chat message", err));
    });

    socket.on('pass', async (data) => {
        const password = data[0];
        if (password === config.adminPass) {
            console.log('[ADMIN] ' + currentPlayer.name + ' just logged in as an admin.');
            socket.emit('serverMSG', 'Welcome back ' + currentPlayer.name);
            socket.broadcast.emit('serverMSG', currentPlayer.name + ' just logged in as an admin.');
            currentPlayer.admin = true;
        } else {
            console.log('[ADMIN] ' + currentPlayer.name + ' attempted to log in with the incorrect password: ' + password);

            socket.emit('serverMSG', 'Password incorrect, attempt logged.');

            loggingRepositry.logFailedLoginAttempt(currentPlayer.name, currentPlayer.ipAddress)
                .catch((err) => console.error("Error when attempting to log failed login attempt", err));
        }
    });

    socket.on('kick', (data) => {
        if (!currentPlayer.admin) {
            socket.emit('serverMSG', 'You are not permitted to use this command.');
            return;
        }

        var reason = '';
        var worked = false;
        for (let playerIndex in map.players.data) {
            let player = map.players.data[playerIndex];
            if (player.name === data[0] && !player.admin && !worked) {
                if (data.length > 1) {
                    for (var f = 1; f < data.length; f++) {
                        if (f === data.length) {
                            reason = reason + data[f];
                        }
                        else {
                            reason = reason + data[f] + ' ';
                        }
                    }
                }
                if (reason !== '') {
                    console.log('[ADMIN] User ' + player.name + ' kicked successfully by ' + currentPlayer.name + ' for reason ' + reason);
                }
                else {
                    console.log('[ADMIN] User ' + player.name + ' kicked successfully by ' + currentPlayer.name);
                }
                socket.emit('serverMSG', 'User ' + player.name + ' was kicked by ' + currentPlayer.name);
                sockets[player.id].emit('kick', reason);
                sockets[player.id].disconnect();
                map.players.removePlayerByIndex(playerIndex);
                worked = true;
            }
        }
        if (!worked) {
            socket.emit('serverMSG', 'Could not locate user or user is an admin.');
        }
    });

    // Heartbeat function, update everytime.
    socket.on('0', (target) => {
        currentPlayer.lastHeartbeat = new Date().getTime();
        if (target.x !== currentPlayer.x || target.y !== currentPlayer.y) {
            currentPlayer.target = target;
        }
    });

    socket.on('1', function () {
        // Fire food.
        const minCellMass = config.defaultPlayerMass + config.fireFood;
        for (let i = 0; i < currentPlayer.cells.length; i++) {
            if (currentPlayer.cells[i].mass >= minCellMass) {
                currentPlayer.changeCellMass(i, -config.fireFood);
                map.massFood.addNew(currentPlayer, i, config.fireFood);
            }
        }
    });

    socket.on('2', () => {
        currentPlayer.userSplit(config.limitSplit, config.defaultPlayerMass);
    });

    // Fusão forçada (cliente: Backspace). Cooldown pra evitar split+merge exploit.
    socket.on('forceMerge', () => {
        const cd = config.forceMergeCooldownMs || 1500;
        const now = Date.now();
        if (currentPlayer._nextForceMergeAt && now < currentPlayer._nextForceMergeAt) {
            return;
        }
        if (currentPlayer.forceMergeAll()) {
            currentPlayer._nextForceMergeAt = now + cd;
            console.log('[INFO] forceMerge por', currentPlayer.name);
        }
    });
}

const addSpectator = (socket) => {
    socket.on('gotit', function () {
        sockets[socket.id] = socket;
        if (spectators.indexOf(socket.id) === -1) {
            spectators.push(socket.id);
        }
        io.emit('playerJoin', { name: '' });
    });

    socket.on('disconnect', function () {
        const i = spectators.indexOf(socket.id);
        if (i !== -1) spectators.splice(i, 1);
        delete sockets[socket.id];
    });

    socket.emit("welcome", {}, {
        width: config.gameWidth,
        height: config.gameHeight
    });
}

const tickPlayer = (currentPlayer, foodEaten, massEaten) => {
    const sock = sockets[currentPlayer.id];
    if (!sock) return;

    if (currentPlayer.lastHeartbeat < new Date().getTime() - config.maxHeartbeatInterval) {
        try {
            sock.emit('kick', 'Last heartbeat received over ' + config.maxHeartbeatInterval + ' ago.');
            sock.disconnect();
        } catch (_) { /* ignore */ }
        return;
    }

    currentPlayer.move(config.slowBase, config.gameWidth, config.gameHeight, INIT_MASS_LOG);

    const isEntityInsideCircle = (point, circle) => {
        return SAT.pointInCircle(new Vector(point.x, point.y), circle);
    };

    const canEatMass = (cell, cellCircle, cellIndex, mass) => {
        if (isEntityInsideCircle(mass, cellCircle)) {
            if (mass.id === currentPlayer.id && mass.speed > 0 && cellIndex === mass.num)
                return false;
            if (cell.mass > mass.mass * 1.1)
                return true;
        }
        return false;
    };

    const canEatVirus = (cell, cellCircle, virus) => {
        return virus.mass < cell.mass && isEntityInsideCircle(virus, cellCircle);
    };

    const cellsToSplit = [];
    for (let cellIndex = 0; cellIndex < currentPlayer.cells.length; cellIndex++) {
        const currentCell = currentPlayer.cells[cellIndex];
        const cellCircle = currentCell.toCircle();
        const radius = currentCell.radius;

        foodGrid.queryCircle(currentCell.x, currentCell.y, radius, _queryBuf);
        perf.foodIndexScans += _queryBuf.length;
        const eatenFoodIndexes = [];
        for (let q = 0; q < _queryBuf.length; q++) {
            const idx = _queryBuf[q];
            if (foodEaten.has(idx)) continue;
            const food = map.food.data[idx];
            if (food && isEntityInsideCircle(food, cellCircle)) {
                eatenFoodIndexes.push(idx);
                foodEaten.add(idx);
            }
        }

        massGrid.queryCircle(currentCell.x, currentCell.y, radius, _queryBuf);
        const eatenMassIndexes = [];
        for (let q = 0; q < _queryBuf.length; q++) {
            const idx = _queryBuf[q];
            if (massEaten.has(idx)) continue;
            const mass = map.massFood.data[idx];
            if (mass && canEatMass(currentCell, cellCircle, cellIndex, mass)) {
                eatenMassIndexes.push(idx);
                massEaten.add(idx);
            }
        }

        virusGrid.queryCircle(currentCell.x, currentCell.y, radius, _queryBuf);
        const eatenVirusIndexes = [];
        for (let q = 0; q < _queryBuf.length; q++) {
            const idx = _queryBuf[q];
            const virus = map.viruses.data[idx];
            if (virus && canEatVirus(currentCell, cellCircle, virus)) {
                eatenVirusIndexes.push(idx);
            }
        }

        if (eatenVirusIndexes.length > 0) {
            cellsToSplit.push(cellIndex);
            map.viruses.delete(eatenVirusIndexes);
            rebuildEntityGrid(virusGrid, map.viruses.data);
        }

        let massGained = 0;
        for (let i = 0; i < eatenMassIndexes.length; i++) {
            massGained += map.massFood.data[eatenMassIndexes[i]].mass;
        }
        massGained += (eatenFoodIndexes.length * config.foodMass);
        currentPlayer.changeCellMass(cellIndex, massGained);
    }
    currentPlayer.virusSplit(cellsToSplit, config.limitSplit, config.defaultPlayerMass);
};

const tickGame = () => {
    const t0 = process.hrtime.bigint();
    perf.foodIndexScans = 0;
    perf.playerPairChecks = 0;

    rebuildEntityGrid(foodGrid, map.food.data);
    rebuildEntityGrid(massGrid, map.massFood.data);
    rebuildEntityGrid(virusGrid, map.viruses.data);

    for (let i = map.players.data.length - 1; i >= 0; i--) {
        if (!sockets[map.players.data[i].id]) {
            console.log('[INFO] Removendo jogador sem socket:', map.players.data[i].name);
            map.players.removePlayerByIndex(i);
        }
    }

    const foodEaten = new Set();
    const massEaten = new Set();
    for (let i = 0; i < map.players.data.length; i++) {
        tickPlayer(map.players.data[i], foodEaten, massEaten);
    }

    if (foodEaten.size) {
        map.food.delete(Array.from(foodEaten));
    }
    if (massEaten.size) {
        map.massFood.remove(Array.from(massEaten));
    }

    map.massFood.move(config.gameWidth, config.gameHeight);

    perf.playerPairChecks = map.players.handleCollisionsSpatial(playerGrid, function (gotEaten, eater) {
        if (!map.players.data[eater.playerIndex] || !map.players.data[gotEaten.playerIndex]) {
            return;
        }
        const cellGotEaten = map.players.getCell(gotEaten.playerIndex, gotEaten.cellIndex);
        if (!cellGotEaten) return;

        map.players.data[eater.playerIndex].changeCellMass(eater.cellIndex, cellGotEaten.mass);

        const playerDied = map.players.removeCell(gotEaten.playerIndex, gotEaten.cellIndex);
        if (playerDied) {
            let playerGotEaten = map.players.data[gotEaten.playerIndex];
            io.emit('playerDied', { name: playerGotEaten.name });
            sockets[playerGotEaten.id].emit('RIP');
            map.players.removePlayerByIndex(gotEaten.playerIndex);
        }
    });

    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    perf.lastTickMs = ms;
    pushSample(perf.tickSamples, ms);
};

const calculateLeaderboard = () => {
    const topPlayers = map.players.getTopPlayers();

    if (leaderboard.length !== topPlayers.length) {
        leaderboard = topPlayers;
        leaderboardChanged = true;
    } else {
        for (let i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].id !== topPlayers[i].id) {
                leaderboard = topPlayers;
                leaderboardChanged = true;
                break;
            }
        }
    }
}

const gameloop = () => {
    if (map.players.data.length > 0) {
        calculateLeaderboard();
        map.players.shrinkCells(config.massLossRate, config.defaultPlayerMass, config.minMassLoss);
    }

    map.balanceMass(config.foodMass, config.gameMass, config.maxFood, config.maxVirus);
};

const sendUpdates = () => {
    const t0 = process.hrtime.bigint();
    spectators.forEach(updateSpectator);
    map.enumerateWhatPlayersSee(function (playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses) {
        sockets[playerData.id].emit('serverTellPlayerMove', playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses);
        if (leaderboardChanged) {
            sendLeaderboard(sockets[playerData.id]);
        }
    });

    leaderboardChanged = false;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    perf.lastSendMs = ms;
    pushSample(perf.sendSamples, ms);
};

const sendLeaderboard = (socket) => {
    socket.emit('leaderboard', {
        players: map.players.data.length,
        leaderboard
    });
}
function extractSpectatorPlayer(p) {
    return {
        x: p.x,
        y: p.y,
        cells: (p.cells || []).map((c) => ({
            x: c.x,
            y: c.y,
            mass: c.mass,
            radius: c.radius,
        })),
        massTotal: Math.round(p.massTotal || 0),
        hue: p.hue,
        id: p.id,
        name: p.name,
    };
}

/** Amostra comida de forma uniforme — evita payload de milhares de entidades por tick. */
function sampleFoodForSpectator(foodArr, maxCount) {
    const n = foodArr.length;
    if (n <= maxCount) return foodArr;
    const out = new Array(maxCount);
    const step = n / maxCount;
    for (let i = 0; i < maxCount; i++) {
        out[i] = foodArr[Math.floor(i * step)];
    }
    return out;
}

const updateSpectator = (socketID) => {
    const sock = sockets[socketID];
    if (!sock) return;

    const playerData = {
        x: config.gameWidth / 2,
        y: config.gameHeight / 2,
        cells: [],
        massTotal: 0,
        hue: 100,
        id: socketID,
        name: ''
    };
    const maxFood = config.spectatorMaxFood || 450;
    const players = map.players.data.map(extractSpectatorPlayer);
    const food = sampleFoodForSpectator(map.food.data, maxFood);
    sock.emit('serverTellPlayerMove', playerData, players, food, map.massFood.data, map.viruses.data);
    if (leaderboardChanged) {
        sendLeaderboard(sock);
    }
}

setInterval(tickGame, 1000 / 60);
setInterval(gameloop, 1000);
setInterval(sendUpdates, 1000 / config.networkUpdateFactor);

// Don't touch, IP configurations.
var ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || config.host;
var serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || config.port;
http.listen(serverport, ipaddress, () => {
    console.log('[DEBUG] Listening on ' + ipaddress + ':' + serverport);
    console.log('[LAN] Preparando URL + QR code para a rede local...');
    printLanInvite(serverport).catch((err) => {
        console.log('[LAN] Erro ao montar convite:', err.message);
    });
});
