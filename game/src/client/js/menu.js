(function () {
  var STORAGE_NAME = 'openAgar.playerName';
  var STORAGE_HUE = 'openAgar.playerHue';
  var STORAGE_MASS = 'openAgar.startMass';
  var HUES = [8, 32, 48, 120, 160, 190, 210, 265, 300, 330, 10000000];
  var MASS_PRESETS = [10, 50, 100, 250, 500, 1000, 2000, 10000000];
  var MIN_START_MASS = 100;
  var MAX_START_MASS = 100000000;

  function $(id) {
    return document.getElementById(id);
  }

  function showMenuError(msg) {
    var el = $('menuError');
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function setNickInvalid(on) {
    var input = $('playerNameInput');
    var fmt = $('nickFormatError') || document.querySelector('#startMenu .input-error');
    if (input) input.classList.toggle('is-invalid', !!on);
    if (fmt) fmt.classList.toggle('is-visible', !!on);
    if (fmt) fmt.style.opacity = on ? '1' : '0';
  }

  function applyHue(hue) {
    window.__playerHue = hue;
    try { localStorage.setItem(STORAGE_HUE, String(hue)); } catch (e) { /* ignore */ }
    var preview = $('colorPreview');
    if (preview) preview.style.background = 'hsl(' + hue + ', 75%, 48%)';
    var swatches = document.querySelectorAll('.color-swatch');
    swatches.forEach(function (btn) {
      var h = Number(btn.getAttribute('data-hue'));
      btn.classList.toggle('is-selected', h === hue);
      btn.setAttribute('aria-selected', h === hue ? 'true' : 'false');
    });
  }

  function buildSwatches() {
    var host = $('colorSwatches');
    if (!host) return;
    host.innerHTML = '';
    var saved = null;
    try { saved = Number(localStorage.getItem(STORAGE_HUE)); } catch (e) { /* ignore */ }
    if (!(saved >= 0 && saved <= 360)) {
      saved = HUES[Math.floor(Math.random() * HUES.length)];
    }
    HUES.forEach(function (hue) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-swatch';
      btn.setAttribute('role', 'option');
      btn.setAttribute('data-hue', String(hue));
      btn.style.background = 'hsl(' + hue + ', 75%, 48%)';
      btn.title = 'Cor ' + hue;
      btn.addEventListener('click', function () { applyHue(hue); });
      host.appendChild(btn);
    });
    applyHue(saved);
  }

  function refreshOnline() {
    var pill = $('onlinePill');
    var label = $('onlineCount');
    if (!label) return;
    fetch('/api/stats', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('bad status');
        return r.json();
      })
      .then(function (data) {
        var n = Number(data.players) || 0;
        label.textContent = n === 1 ? '1 jogador online agora' : n + ' jogadores online agora';
        if (pill) pill.classList.remove('is-offline');
      })
      .catch(function () {
        label.textContent = 'servidor offline';
        if (pill) pill.classList.add('is-offline');
      });
  }

  function clampStartMass(value) {
    var n = Math.round(Number(value));
    if (!Number.isFinite(n)) n = MIN_START_MASS;
    return Math.max(MIN_START_MASS, Math.min(MAX_START_MASS, n));
  }

  function applyStartMass(mass) {
    mass = clampStartMass(mass);
    window.__startMass = mass;
    try { localStorage.setItem(STORAGE_MASS, String(mass)); } catch (e) { /* ignore */ }
    var input = $('startMassInput');
    if (input && document.activeElement !== input) input.value = String(mass);
    var chips = document.querySelectorAll('.mass-chip');
    chips.forEach(function (btn) {
      var v = Number(btn.getAttribute('data-mass'));
      btn.classList.toggle('is-selected', v === mass);
      btn.setAttribute('aria-selected', v === mass ? 'true' : 'false');
    });
  }

  function buildMassPresets() {
    var host = $('massPresets');
    var input = $('startMassInput');
    var saved = MIN_START_MASS;
    try { saved = clampStartMass(localStorage.getItem(STORAGE_MASS) || MIN_START_MASS); } catch (e) { /* ignore */ }
    if (host) {
      host.innerHTML = '';
      MASS_PRESETS.forEach(function (mass) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mass-chip';
        btn.setAttribute('role', 'option');
        btn.setAttribute('data-mass', String(mass));
        btn.textContent = String(mass);
        btn.addEventListener('click', function () { applyStartMass(mass); });
        host.appendChild(btn);
      });
    }
    if (input) {
      input.min = String(MIN_START_MASS);
      input.max = String(MAX_START_MASS);
      input.addEventListener('input', function () {
        applyStartMass(input.value);
      });
      input.addEventListener('change', function () {
        applyStartMass(input.value);
      });
    }
    applyStartMass(saved);
  }

  function rememberName() {
    var input = $('playerNameInput');
    if (!input) return;
    try {
      var saved = localStorage.getItem(STORAGE_NAME);
      if (saved) input.value = saved;
    } catch (e) { /* ignore */ }
    input.addEventListener('change', function () {
      try { localStorage.setItem(STORAGE_NAME, input.value.trim()); } catch (e) { /* ignore */ }
    });
  }

  function wireSettings() {
    var chat = window.chat;
    if (!chat) return;
    var map = [
      ['visBord', 'toggleBorder'],
      ['showMass', 'toggleMass'],
      ['continuity', 'toggleContinuity'],
      ['roundFood', 'toggleRoundFood'],
      ['darkMode', 'toggleDarkMode'],
    ];
    map.forEach(function (pair) {
      var el = $(pair[0]);
      if (!el || typeof chat[pair[1]] !== 'function') return;
      el.onchange = function () {
        chat[pair[1]](el.checked);
      };
    });
  }

  function enhanceValidation() {
    var input = $('playerNameInput');
    var startBtn = $('startButton');
    if (!input || !startBtn) return;

    input.addEventListener('input', function () {
      setNickInvalid(false);
      showMenuError('');
    });

    // Feedback visual extra antes do handler do app.js
    startBtn.addEventListener('click', function (e) {
      var name = input.value.trim();
      var okFormat = /^\w+$/.test(input.value);
      if (!name || !okFormat) {
        setNickInvalid(true);
        showMenuError(
          !name
            ? 'Digite um nome para entrar no jogo.'
            : 'Use só letras, números e underscore — sem espaços.'
        );
        input.focus();
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      showMenuError('');
      setNickInvalid(false);
      try { localStorage.setItem(STORAGE_NAME, name); } catch (err) { /* ignore */ }
      var spawn = document.getElementById('spawn_cell');
      if (spawn && spawn.play) {
        try { spawn.play(); } catch (err) { /* ignore */ }
      }
    }, true);
  }

  function observeMenuVisibility() {
    // Quando o menu volta após RIP, atualiza contador
    var wrapper = $('startMenuWrapper');
    if (!wrapper || typeof MutationObserver === 'undefined') return;
    var obs = new MutationObserver(function () {
      if (!wrapper.classList.contains('is-hidden') && wrapper.style.maxHeight !== '0px') {
        refreshOnline();
      }
    });
    obs.observe(wrapper, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  function boot() {
    rememberName();
    buildSwatches();
    buildMassPresets();
    enhanceValidation();
    wireSettings();
    observeMenuVisibility();
    refreshOnline();
    setInterval(refreshOnline, 4000);

    window.__menuUI = {
      showError: showMenuError,
      setNickInvalid: setNickInvalid,
      refreshOnline: refreshOnline,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
