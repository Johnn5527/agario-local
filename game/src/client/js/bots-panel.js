(function () {
  // Mesmo host da página (localhost OU IP da LAN) — nunca hardcoded.
  var API = 'http://' + window.location.hostname + ':3001';

  function $(id) {
    return document.getElementById(id);
  }

  function targetName() {
    var input = $('playerNameInput');
    var name = input && input.value ? input.value.trim() : '';
    return name || 'Johnny';
  }

  function botCount() {
    var input = $('botsCountInput');
    var n = input ? parseInt(input.value, 10) : 4;
    if (isNaN(n) || n < 1) n = 1;
    if (n > 20) n = 20;
    return n;
  }

  function setStatus(text, ok) {
    var menu = $('botsStatusMenu');
    var hud = $('botsStatusHud');
    if (menu) {
      menu.textContent = text;
      menu.className = 'bots-status' + (ok === false ? ' err' : ok ? ' ok' : '');
    }
    if (hud) hud.textContent = text;
  }

  function formatStatus(data) {
    if (!data.running) return 'Bots parados.';
    var lines = [
      'Rodando → alvo: ' + data.targetName +
      ' (' + data.bots.length + ') | modo: ' + (data.feedingMode || '?') +
      ' | sacr≈' + Math.round(data.totalMassSacrificed || 0)
    ];
    data.bots.forEach(function (b) {
      var mark = b.state === 'SACRIFICING' ? '★ ' : '';
      lines.push(
        mark + b.name + ': ' + b.state +
        ' | massa ' + b.mass +
        (b.targetVisible ? ' | dist ' + b.targetDist : ' | procurando você') +
        (b.totalMassSacrificed ? ' | entregue≈' + b.totalMassSacrificed : '')
      );
    });
    if (data.sacrificeLog && data.sacrificeLog.length) {
      var last = data.sacrificeLog[data.sacrificeLog.length - 1];
      lines.push('último sacrifício: ' + last.name + ' ~' + Math.round(last.mass));
    }
    return lines.join('\n');
  }

  function refresh() {
    fetch(API + '/api/status')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        setStatus(formatStatus(data), data.running);
      })
      .catch(function () {
        setStatus('Painel offline — rode: cd bots && npm start', false);
      });
  }

  function startBots() {
    var payload = { target: targetName(), count: botCount() };
    setStatus('Chamando ' + payload.count + ' bots para "' + payload.target + '"...');
    fetch(API + '/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        setStatus(formatStatus(data), true);
      })
      .catch(function () {
        setStatus('Falha ao chamar bots. Suba o painel: cd bots && npm start', false);
      });
  }

  function stopBots() {
    fetch(API + '/api/stop', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        setStatus(formatStatus(data), false);
      })
      .catch(function () {
        setStatus('Painel offline — rode: cd bots && npm start', false);
      });
  }

  function syncHudVisibility() {
    var hud = $('botsHud');
    var game = $('gameAreaWrapper');
    if (!hud || !game) return;
    var playing = parseFloat(game.style.opacity || '0') > 0.5;
    hud.style.display = playing ? 'block' : 'none';
  }

  function bind() {
    var startBtn = $('botsStartButton');
    var stopBtn = $('botsStopButton');
    var startHud = $('botsStartHud');
    var stopHud = $('botsStopHud');
    var playBtn = $('startButton');
    if (startBtn) startBtn.addEventListener('click', startBots);
    if (stopBtn) stopBtn.addEventListener('click', stopBots);
    if (startHud) startHud.addEventListener('click', startBots);
    if (stopHud) stopHud.addEventListener('click', stopBots);
    if (playBtn) {
      playBtn.addEventListener('click', function () {
        setTimeout(syncHudVisibility, 50);
      });
    }
    refresh();
    setInterval(refresh, 2000);
    setInterval(syncHudVisibility, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
