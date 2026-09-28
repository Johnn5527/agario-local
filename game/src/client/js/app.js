var io = require('socket.io-client');
var render = require('./render');
var ChatClient = require('./chat-client');
var Canvas = require('./canvas');
var global = require('./global');
var zoom = require('./zoom');

var playerNameInput = document.getElementById('playerNameInput');
var socket;

var debug = function (args) {
    if (console && console.log) {
        console.log(args);
    }
};

if (/Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent)) {
    global.mobile = true;
}

function startGame(type) {
    global.playerName = playerNameInput.value.replace(/(<([^>]+)>)/ig, '').substring(0, 25);
    global.playerType = type;

    global.screen.width = window.innerWidth;
    global.screen.height = window.innerHeight;

    try {
        if (global.playerName) {
            localStorage.setItem('openAgar.playerName', global.playerName);
        }
    } catch (e) { /* ignore */ }

    var menu = document.getElementById('startMenuWrapper');
    menu.style.maxHeight = '0px';
    menu.classList.add('is-hidden');
    document.getElementById('gameAreaWrapper').style.opacity = 1;
    if (!socket) {
        socket = io({ query: "type=" + type });
        setupSocket(socket);
    }
    if (!global.animLoopHandle)
        animloop();
    socket.emit('respawn');
    window.chat.socket = socket;
    window.chat.registerFunctions();
    window.canvas.socket = socket;
    global.socket = socket;
}

// Checks if the nick chosen contains valid alphanumeric characters (and underscores).
function validNick() {
    var value = playerNameInput.value;
    var regex = /^\w+$/; // exige pelo menos 1 caractere alfanumérico/_
    debug('Regex Test', regex.exec(value));
    return regex.exec(value) !== null;
}

function showStartMenu() {
    var menu = document.getElementById('startMenuWrapper');
    menu.classList.remove('is-hidden');
    menu.style.maxHeight = '100vh';
    if (window.__menuUI && window.__menuUI.refreshOnline) {
        window.__menuUI.refreshOnline();
    }
}

window.onload = function () {

    var btn = document.getElementById('startButton'),
        btnS = document.getElementById('spectateButton'),
        nickErrorText = document.querySelector('#startMenu .input-error');

    btnS.onclick = function () {
        startGame('spectator');
    };

    btn.onclick = function () {
        if (validNick()) {
            nickErrorText.style.opacity = 0;
            nickErrorText.classList.remove('is-visible');
            playerNameInput.classList.remove('is-invalid');
            if (window.__menuUI) window.__menuUI.showError('');
            startGame('player');
        } else {
            nickErrorText.style.opacity = 1;
            nickErrorText.classList.add('is-visible');
            playerNameInput.classList.add('is-invalid');
            if (window.__menuUI) {
                window.__menuUI.showError(
                    playerNameInput.value.trim()
                        ? 'Use só letras, números e underscore — sem espaços.'
                        : 'Digite um nome para entrar no jogo.'
                );
            }
        }
    };

    var settingsMenu = document.getElementById('settingsButton');
    var settingsPanel = document.getElementById('settings');

    settingsMenu.onclick = function () {
        settingsPanel.classList.toggle('is-open');
        if (settingsPanel.classList.contains('is-open')) {
            settingsPanel.style.maxHeight = '320px';
        } else {
            settingsPanel.style.maxHeight = '0px';
        }
    };

    playerNameInput.addEventListener('keypress', function (e) {
        var key = e.which || e.keyCode;

        if (key === global.KEY_ENTER) {
            e.preventDefault();
            btn.click();
        }
    });
};

// TODO: Break out into GameControls.

var playerConfig = {
    border: 6,
    textColor: '#FFFFFF',
    textBorder: '#000000',
    textBorderSize: 3,
    defaultSize: 30
};

var player = {
    id: -1,
    x: global.screen.width / 2,
    y: global.screen.height / 2,
    screenWidth: global.screen.width,
    screenHeight: global.screen.height,
    target: { x: global.screen.width / 2, y: global.screen.height / 2 }
};
global.player = player;

var foods = [];
var viruses = [];
var fireFood = [];
var users = [];
var leaderboard = [];
var target = { x: player.x, y: player.y };
global.target = target;

// Estado de interpolação (prev → next)
var snapPrev = null;
var snapNext = null;
var snapAt = 0;

// Zoom suave da câmera (jogadores; spectate usa escala própria)
var cameraZoom = zoom.ZOOM_CONFIG.baseZoom;
global.viewScale = cameraZoom;
var lastViewSyncAt = 0;
var lastSyncedScale = 0;

function cloneSnap(playerData, userData, foodsList, massList, virusList) {
    return {
        player: playerData ? {
            x: playerData.x,
            y: playerData.y,
            hue: playerData.hue,
            massTotal: playerData.massTotal,
            cells: playerData.cells
        } : null,
        users: userData || [],
        foods: foodsList || [],
        fireFood: massList || [],
        viruses: virusList || []
    };
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

window.canvas = new Canvas();
window.chat = new ChatClient();

var visibleBorderSetting = document.getElementById('visBord');
visibleBorderSetting.onchange = function () { window.chat.toggleBorder(); };

var showMassSetting = document.getElementById('showMass');
showMassSetting.onchange = function () { window.chat.toggleMass(); };

var continuitySetting = document.getElementById('continuity');
continuitySetting.onchange = function () { window.chat.toggleContinuity(); };

var roundFoodSetting = document.getElementById('roundFood');
roundFoodSetting.onchange = function () { window.chat.toggleRoundFood(roundFoodSetting.checked); };

var darkModeSetting = document.getElementById('darkMode');
if (darkModeSetting) {
    darkModeSetting.onchange = function () { window.chat.toggleDarkMode(); };
}

var c = window.canvas.cv;
var graph = c.getContext('2d');

$("#feed").click(function () {
    socket.emit('1');
    window.canvas.reenviar = false;
});

$("#split").click(function () {
    socket.emit('2');
    window.canvas.reenviar = false;
});

function handleDisconnect() {
    socket.close();
    if (!global.kicked) {
        render.drawErrorMessage('Disconnected!', graph, global.screen);
        if (window.__menuUI) {
            window.__menuUI.showError('Conexão com o servidor falhou. Confira se o jogo ainda está rodando e tente de novo.');
        }
        showStartMenu();
        document.getElementById('gameAreaWrapper').style.opacity = 0;
    }
}

// socket stuff.
function setupSocket(socket) {
    // Handle ping.
    socket.on('pongcheck', function () {
        var latency = Date.now() - global.startPingTime;
        debug('Latency: ' + latency + 'ms');
        window.chat.addSystemLine('Ping: ' + latency + 'ms');
    });

    // Handle error.
    socket.on('connect_error', handleDisconnect);
    socket.on('disconnect', handleDisconnect);

    // Handle connection.
    socket.on('welcome', function (playerSettings, gameSizes) {
        player = playerSettings || {};
        player.name = global.playerName;
        player.screenWidth = global.screen.width;
        player.screenHeight = global.screen.height;
        player.target = window.canvas.target;
        if (typeof window.__playerHue === 'number') {
            player.hue = window.__playerHue;
        }
        if (typeof window.__startMass === 'number') {
            player.startMass = window.__startMass;
        }
        global.player = player;
        window.chat.player = player;
        socket.emit('gotit', player);
        global.gameStart = true;
        window.chat.addSystemLine('Connected to the game!');
        if (global.playerType === 'spectator') {
            window.chat.addSystemLine('Modo Assistir: visão geral do mapa.');
        } else {
            window.chat.addSystemLine('Type <b>-help</b> for a list of commands.');
        }
        if (global.mobile) {
            document.getElementById('gameAreaWrapper').removeChild(document.getElementById('chatbox'));
        }
        c.focus();
        global.game.width = gameSizes.width;
        global.game.height = gameSizes.height;
        cameraZoom = zoom.ZOOM_CONFIG.baseZoom;
        global.viewScale = cameraZoom;
        lastSyncedScale = 0;
        resize();
    });

    socket.on('playerDied', (data) => {
        const player = isUnnamedCell(data.playerEatenName) ? 'An unnamed cell' : data.playerEatenName;
        //const killer = isUnnamedCell(data.playerWhoAtePlayerName) ? 'An unnamed cell' : data.playerWhoAtePlayerName;

        //window.chat.addSystemLine('{GAME} - <b>' + (player) + '</b> was eaten by <b>' + (killer) + '</b>');
        window.chat.addSystemLine('{GAME} - <b>' + (player) + '</b> was eaten');
    });

    socket.on('playerDisconnect', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> disconnected.');
    });

    socket.on('playerJoin', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> joined.');
    });

    socket.on('leaderboard', (data) => {
        leaderboard = data.leaderboard;
        var status = '<span class="title">Leaderboard</span>';
        for (var i = 0; i < leaderboard.length; i++) {
            status += '<br />';
            if (leaderboard[i].id == player.id) {
                if (leaderboard[i].name.length !== 0)
                    status += '<span class="me">' + (i + 1) + '. ' + leaderboard[i].name + "</span>";
                else
                    status += '<span class="me">' + (i + 1) + ". An unnamed cell</span>";
            } else {
                if (leaderboard[i].name.length !== 0)
                    status += (i + 1) + '. ' + leaderboard[i].name;
                else
                    status += (i + 1) + '. An unnamed cell';
            }
        }
        //status += '<br />Players: ' + data.players;
        document.getElementById('status').innerHTML = status;
    });

    socket.on('serverMSG', function (data) {
        window.chat.addSystemLine(data);
    });

    // Chat.
    socket.on('serverSendPlayerChat', function (data) {
        window.chat.addChatLine(data.sender, data.message, false);
    });

    // Handle movement + snapshot para interpolação.
    socket.on('serverTellPlayerMove', function (playerData, userData, foodsList, massList, virusList) {
        snapPrev = snapNext;
        snapNext = cloneSnap(playerData, userData, foodsList, massList, virusList);
        snapAt = performance.now();

        // Estado lógico imediato (para input / morte / HUD)
        if (global.playerType == 'player') {
            player.x = playerData.x;
            player.y = playerData.y;
            player.hue = playerData.hue;
            player.massTotal = playerData.massTotal;
            player.cells = playerData.cells;
        }
        users = userData;
        foods = foodsList;
        viruses = virusList;
        fireFood = massList;
    });

    // Death.
    socket.on('RIP', function () {
        global.gameStart = false;
        render.drawErrorMessage('You died!', graph, global.screen);
        window.setTimeout(() => {
            document.getElementById('gameAreaWrapper').style.opacity = 0;
            showStartMenu();
            if (global.animLoopHandle) {
                window.cancelAnimationFrame(global.animLoopHandle);
                global.animLoopHandle = undefined;
            }
        }, 2500);
    });

    socket.on('kick', function (reason) {
        global.gameStart = false;
        global.kicked = true;
        if (reason !== '') {
            render.drawErrorMessage('You were kicked for: ' + reason, graph, global.screen);
        }
        else {
            render.drawErrorMessage('You were kicked!', graph, global.screen);
        }
        socket.close();
    });
}

const isUnnamedCell = (name) => name.length < 1;

const getPosition = (entity, player, screen, scale) => {
    const s = (scale == null || scale === 1) ? 1 : scale;
    return {
        x: (entity.x - player.x) * s + screen.width / 2,
        y: (entity.y - player.y) * s + screen.height / 2
    };
};

/** Escala pra caber o mapa inteiro na janela (modo Assistir). */
function spectatorViewScale() {
    if (!global.game.width || !global.game.height) return 1;
    const pad = 0.98;
    return Math.min(
        global.screen.width / global.game.width,
        global.screen.height / global.game.height
    ) * pad;
}

/** Informa ao servidor a área de mundo realmente visível (screen / scale). */
function syncViewToServer(force) {
    if (!socket || global.playerType !== 'player') return;
    const scale = Math.max(0.05, global.viewScale || 1);
    const now = performance.now();
    if (!force) {
        if (now - lastViewSyncAt < 150) return;
        if (Math.abs(scale - lastSyncedScale) < 0.015 && now - lastViewSyncAt < 800) return;
    }
    lastViewSyncAt = now;
    lastSyncedScale = scale;
    const vw = Math.round(global.screen.width / scale);
    const vh = Math.round(global.screen.height / scale);
    player.screenWidth = vw;
    player.screenHeight = vh;
    socket.emit('windowResized', { screenWidth: vw, screenHeight: vh });
}

window.requestAnimFrame = (function () {
    return window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        window.msRequestAnimationFrame ||
        function (callback) {
            window.setTimeout(callback, 1000 / 60);
        };
})();

window.cancelAnimFrame = (function (handle) {
    return window.cancelAnimationFrame ||
        window.mozCancelAnimationFrame;
})();

function animloop() {
    global.animLoopHandle = window.requestAnimFrame(animloop);
    gameLoop();
}

function gameLoop() {
    if (global.gameStart) {
        graph.fillStyle = global.backgroundColor;
        graph.fillRect(0, 0, global.screen.width, global.screen.height);

        // Interpolação entre o penúltimo e o último pacote
        var renderPlayer = player;
        var renderUsers = users;
        var renderFoods = foods;
        var renderFire = fireFood;
        var renderViruses = viruses;
        if (snapPrev && snapNext && snapPrev.player && snapNext.player) {
            var t = (performance.now() - snapAt) / global.netUpdateIntervalMs;
            if (t < 0) t = 0;
            if (t > 1) t = 1;
            renderPlayer = {
                x: lerp(snapPrev.player.x, snapNext.player.x, t),
                y: lerp(snapPrev.player.y, snapNext.player.y, t),
                hue: snapNext.player.hue,
                massTotal: snapNext.player.massTotal,
                cells: snapNext.player.cells
            };
            renderUsers = snapNext.users;
            renderFoods = snapNext.foods;
            renderFire = snapNext.fireFood;
            renderViruses = snapNext.viruses;
        }

        var isSpectator = global.playerType === 'spectator';
        var viewScale;
        if (isSpectator) {
            viewScale = spectatorViewScale();
            renderPlayer = {
                x: global.game.width / 2,
                y: global.game.height / 2,
                hue: (renderPlayer && renderPlayer.hue) || 100,
                massTotal: 0,
                cells: []
            };
        } else {
            var targetZoom = zoom.computeTargetZoom(renderPlayer, global.screen, zoom.ZOOM_CONFIG);
            cameraZoom = zoom.smoothZoom(cameraZoom, targetZoom, zoom.ZOOM_CONFIG);
            viewScale = cameraZoom;
            syncViewToServer(false);
        }
        global.viewScale = viewScale;

        render.drawGrid(global, renderPlayer, global.screen, graph, viewScale);

        var screenW = global.screen.width;
        var screenH = global.screen.height;
        var margin = isSpectator ? 8 : 40;

        renderFoods.forEach(food => {
            let position = getPosition(food, renderPlayer, global.screen, viewScale);
            if (position.x < -margin || position.y < -margin ||
                position.x > screenW + margin || position.y > screenH + margin) {
                return;
            }
            var foodDraw = viewScale === 1 ? food : Object.assign({}, food, {
                radius: Math.max(1.5, food.radius * viewScale)
            });
            render.drawFood(position, foodDraw, graph);
        });
        renderFire.forEach(ff => {
            let position = getPosition(ff, renderPlayer, global.screen, viewScale);
            if (position.x < -margin || position.y < -margin ||
                position.x > screenW + margin || position.y > screenH + margin) {
                return;
            }
            var ffDraw = viewScale === 1 ? ff : Object.assign({}, ff, {
                radius: Math.max(2, ff.radius * viewScale)
            });
            render.drawFireFood(position, ffDraw, playerConfig, graph);
        });
        renderViruses.forEach(virus => {
            let position = getPosition(virus, renderPlayer, global.screen, viewScale);
            if (position.x < -margin || position.y < -margin ||
                position.x > screenW + margin || position.y > screenH + margin) {
                return;
            }
            var virusDraw = viewScale === 1 ? virus : Object.assign({}, virus, {
                radius: Math.max(3, virus.radius * viewScale),
                strokeWidth: Math.max(1, (virus.strokeWidth || 4) * viewScale)
            });
            render.drawVirus(position, virusDraw, graph);
        });

        let borders = {
            left: (0 - renderPlayer.x) * viewScale + global.screen.width / 2,
            right: (global.game.width - renderPlayer.x) * viewScale + global.screen.width / 2,
            top: (0 - renderPlayer.y) * viewScale + global.screen.height / 2,
            bottom: (global.game.height - renderPlayer.y) * viewScale + global.screen.height / 2
        };
        if (global.borderDraw || isSpectator) {
            render.drawBorder(borders, graph);
        }

        var cellsToDraw = [];
        for (var i = 0; i < renderUsers.length; i++) {
            let color = 'hsl(' + renderUsers[i].hue + ', 100%, 50%)';
            let borderColor = 'hsl(' + renderUsers[i].hue + ', 100%, 45%)';
            for (var j = 0; j < renderUsers[i].cells.length; j++) {
                var cell = renderUsers[i].cells[j];
                var pos = getPosition(cell, renderPlayer, global.screen, viewScale);
                var rad = cell.radius * viewScale;
                if (pos.x + rad < -margin || pos.y + rad < -margin ||
                    pos.x - rad > screenW + margin || pos.y - rad > screenH + margin) {
                    continue;
                }
                cellsToDraw.push({
                    color: color,
                    borderColor: borderColor,
                    mass: cell.mass,
                    name: renderUsers[i].name,
                    radius: rad,
                    x: pos.x,
                    y: pos.y
                });
            }
        }
        cellsToDraw.sort(function (obj1, obj2) {
            return obj1.mass - obj2.mass;
        });
        render.drawCells(cellsToDraw, playerConfig, global.toggleMassState, borders, graph);

        if (!isSpectator) {
            socket.emit('0', window.canvas.target); // Heartbeat
        }
    }
}

window.addEventListener('resize', resize);

function resize() {
    if (!socket) return;

    // Sempre o tamanho da janela — canvas 5000×5000 travava o Assistir
    c.width = global.screen.width = window.innerWidth;
    c.height = global.screen.height = window.innerHeight;

    if (global.playerType == 'spectator') {
        player.x = global.game.width / 2;
        player.y = global.game.height / 2;
        player.screenWidth = global.screen.width;
        player.screenHeight = global.screen.height;
        socket.emit('windowResized', {
            screenWidth: global.screen.width,
            screenHeight: global.screen.height
        });
    } else {
        syncViewToServer(true);
    }
}
