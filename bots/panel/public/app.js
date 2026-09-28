(function () {
  var ws;
  var latest = null;

  function $(id) { return document.getElementById(id); }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host + '/ws');
    ws.onopen = function () {
      $('conn').textContent = 'WS online';
      $('conn').className = 'pill on';
    };
    ws.onclose = function () {
      $('conn').textContent = 'WS offline';
      $('conn').className = 'pill off';
      setTimeout(connect, 1500);
    };
    ws.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.type === 'status') render(msg.data);
        if (msg.type === 'error') console.warn(msg.error);
      } catch (e) { /* ignore */ }
    };
  }

  function send(cmd, extra) {
    var payload = Object.assign({ type: 'command', cmd: cmd }, extra || {});
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    } else {
      fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function (r) { return r.json(); }).then(render);
    }
  }

  function render(data) {
    latest = data;
    var agg = data.aggregates || {};
    $('massDelivered').textContent = Math.round(agg.estimatedMassDelivered || 0);
    $('botsMode').textContent = data.botCount + ' · ' + data.feedingMode;
    $('targetName').textContent = data.targetName || '—';
    $('swarmState').textContent = !data.running ? 'parado' : (data.paused ? 'PAUSADO' : 'ativo');

    if (data.config) {
      if (!$('inpTarget').matches(':focus')) $('inpTarget').value = data.config.TARGET_PLAYER_NAME || '';
      $('inpMode').value = data.config.FEEDING_MODE || 'hybrid';
      if (!$('inpCount').matches(':focus')) $('inpCount').value = data.botCount;
      if (!$('inpApproach').matches(':focus')) $('inpApproach').value = data.config.APPROACH_DISTANCE;
      if (!$('inpFeed').matches(':focus')) $('inpFeed').value = data.config.FEED_DISTANCE;
      if (!$('inpSafe').matches(':focus')) $('inpSafe').value = data.config.MIN_SAFE_DISTANCE;
      if (!$('inpMargin').matches(':focus')) $('inpMargin').value = data.config.SACRIFICE_SAFETY_MARGIN;
      if (!$('inpMinMass').matches(':focus')) $('inpMinMass').value = data.config.SACRIFICE_MIN_BOT_MASS;
    }

    var host = $('bots');
    host.innerHTML = '';
    (data.bots || []).forEach(function (b, i) {
      var el = document.createElement('div');
      el.className = 'bot ' + (b.state || '');
      el.innerHTML =
        '<h3>' + b.name + (b.frozen ? ' ❄' : '') + (b.paused ? ' ⏸' : '') + '</h3>' +
        '<div class="meta">' +
        b.state + ' · massa ' + b.mass +
        (b.targetVisible ? ' · dist ' + b.targetDist : ' · procurando') +
        '<br/>mortes ' + (b.deaths || 0) + ' · sacr≈' + (b.totalMassSacrificed || 0) +
        ' · W≈' + (b.trickleMassDelivered || 0) +
        '</div>' +
        '<div class="actions">' +
        '<button data-i="' + i + '" data-act="freeze">' + (b.frozen ? 'Unfreeze' : 'Freeze') + '</button>' +
        '<button data-i="' + i + '" data-act="explore">Explore</button>' +
        '<button data-i="' + i + '" data-act="sacrifice">Sacrifice</button>' +
        '<button data-i="' + i + '" data-act="reconnect">Reconnect</button>' +
        '<button data-i="' + i + '" data-act="remove">Remover</button>' +
        '</div>';
      host.appendChild(el);
    });

    var ev = (data.events || []).slice(-20).map(function (e) {
      return e.at + '  ' + e.type + '  ' + JSON.stringify(e.detail).slice(0, 70);
    }).join('\n');
    $('events').textContent = ev || '(sem eventos)';

    drawChart(agg.targetMassSeries || []);
  }

  function drawChart(series) {
    var canvas = $('chart');
    var ctx = canvas.getContext('2d');
    var w = canvas.width = canvas.clientWidth || 800;
    var h = canvas.height = 160;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b181d';
    ctx.fillRect(0, 0, w, h);
    if (!series.length) {
      ctx.fillStyle = '#8aa5ab';
      ctx.fillText('Sem dados de massa do alvo ainda', 12, 24);
      return;
    }
    var masses = series.map(function (p) { return p.mass; });
    var min = Math.min.apply(null, masses);
    var max = Math.max.apply(null, masses);
    if (max === min) max = min + 1;
    ctx.strokeStyle = '#1aa6a0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach(function (p, i) {
      var x = (i / Math.max(1, series.length - 1)) * (w - 20) + 10;
      var y = h - 10 - ((p.mass - min) / (max - min)) * (h - 30);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#8aa5ab';
    ctx.fillText('min ' + min + '  max ' + max, 12, 16);
  }

  document.body.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (!btn) return;
    var cmd = btn.getAttribute('data-cmd');
    var act = btn.getAttribute('data-act');
    var idx = btn.getAttribute('data-i');

    if (cmd === 'pause') send('pause');
    if (cmd === 'add') send('add');
    if (cmd === 'remove') send('remove', { selector: (latest && latest.bots.length) ? latest.bots.length - 1 : 0 });
    if (cmd === 'stop') send('stop');
    if (cmd === 'start') {
      send('start', {
        target: $('inpTarget').value || 'Johnny',
        count: Number($('inpCount').value || 4),
        feedingMode: $('inpMode').value,
      });
    }
    if (cmd === 'target') send('target', { target: $('inpTarget').value });
    if (cmd === 'mode') send('mode', { mode: $('inpMode').value });
    if (cmd === 'count') send('count', { count: Number($('inpCount').value) });
    if (cmd === 'config') {
      send('config', {
        patch: {
          APPROACH_DISTANCE: Number($('inpApproach').value),
          FEED_DISTANCE: Number($('inpFeed').value),
          MIN_SAFE_DISTANCE: Number($('inpSafe').value),
          SACRIFICE_SAFETY_MARGIN: Number($('inpMargin').value),
          SACRIFICE_MIN_BOT_MASS: Number($('inpMinMass').value),
        },
      });
    }

    if (act === 'freeze') {
      var bot = latest && latest.bots[idx];
      send(bot && bot.frozen ? 'unfreeze' : 'freeze', { selector: Number(idx) });
    }
    if (act === 'explore') send('explore', { selector: Number(idx) });
    if (act === 'sacrifice') send('sacrifice', { selector: Number(idx) });
    if (act === 'reconnect') send('reconnect', { selector: Number(idx) });
    if (act === 'remove') send('remove', { selector: Number(idx) });
  });

  connect();
  fetch('/api/status').then(function (r) { return r.json(); }).then(render).catch(function () {});
})();
