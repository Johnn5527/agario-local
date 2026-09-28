'use strict';

const io = require('socket.io-client');
const geo = require('./lib/geometry');
const { makeLogger } = require('./lib/logger');
const { buildSweepPath } = require('./lib/sweepPath');
const { evaluateSacrificeSafety } = require('./lib/sacrifice');

const STATE = {
  CONNECTING: 'CONNECTING',
  EXPLORING: 'EXPLORING',
  APPROACHING: 'APPROACHING',
  PREPARING: 'PREPARING',
  FEEDING: 'FEEDING',
  SACRIFICING: 'SACRIFICING', // vai de propósito ser comido pelo alvo
  EVADING: 'EVADING',
  DEAD: 'DEAD',
};

class FeederBot {
  constructor(name, config, swarmIndex = 0, swarmSize = 1, hooks = {}) {
    this.name = name;
    this.cfg = config;
    this.log = makeLogger(name);
    this.swarmIndex = swarmIndex;
    this.swarmSize = Math.max(1, swarmSize);
    this.hooks = hooks; // { onSacrificeAttempt, onSacrificeAbort, onDeath }

    this.socket = null;
    this.connected = false;
    this.alive = false;

    this.self = null;
    this.users = [];
    this.state = STATE.CONNECTING;

    this.lastFeedAt = 0;
    this.lastSplitAt = 0;
    this.reconnectDelay = this.cfg.RECONNECT_BASE_DELAY_MS;

    this._loopHandle = null;
    this._sweepPath = null;
    this._sweepIndex = 0;
    this._sweepLastAdvanceAt = 0;

    this.totalMassSacrificed = 0;
    this.sacrificeEvents = 0;
    this._pendingSacrificeMass = null;
    this._lastSacrificeAudit = null;

    this.paused = false;
    this.frozen = false;
    this.forceSacrificeOverride = false;
    this.bornAt = null;
    this.feedReadyAt = null;
    this.deaths = 0;
    this.respawns = 0;
    this.trickleShots = 0;
    this.trickleMassDelivered = 0;
    this.stateHistory = [];
    this._lastReportedState = null;
  }

  start() {
    this._stopping = false;
    this._connect();
  }

  stop() {
    this._stopping = true;
    this._reconnecting = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._loopHandle) {
      clearInterval(this._loopHandle);
      clearTimeout(this._loopHandle);
      this._loopHandle = null;
    }
    if (this.socket) {
      try { this.socket.disconnect(); } catch (_) { /* ignore */ }
      this.socket = null;
    }
  }

  setPaused(v) {
    this.paused = !!v;
  }

  setFrozen(v) {
    this.frozen = !!v;
  }

  rebalanceSweep() {
    if (!this._sweepPath || !this._sweepPath.length) return;
    this._sweepIndex = Math.floor((this._sweepPath.length / this.swarmSize) * this.swarmIndex);
    this._sweepLastAdvanceAt = Date.now();
  }

  resetSweep() {
    if (!this._sweepPath || !this._sweepPath.length) {
      if (this.gameWidth && this.gameHeight) {
        this._sweepPath = buildSweepPath(
          this.gameWidth, this.gameHeight,
          this.cfg.EXPLORE_CELL_WIDTH, this.cfg.EXPLORE_CELL_HEIGHT
        );
      }
    }
    this.rebalanceSweep();
    this.state = STATE.EXPLORING;
    this.forceSacrificeOverride = false;
    this.log.info('Varredura resetada (force explore)');
  }

  forceSacrificeOnce() {
    this.forceSacrificeOverride = true;
    this.frozen = false;
    this.paused = false;
    this.log.info('Override de sacrifício ativado (ignora massa mínima temporariamente)');
  }

  softReconnect() {
    this.log.info('Soft-reconnect solicitado');
    this._stopping = false;
    if (this._loopHandle) {
      clearInterval(this._loopHandle);
      clearTimeout(this._loopHandle);
      this._loopHandle = null;
    }
    if (this.socket) {
      try { this.socket.disconnect(); } catch (_) { /* ignore */ }
    }
    this.connected = false;
    this.alive = false;
    setTimeout(() => this._connect(), 300);
  }

  _pushStateHistory(state) {
    if (state === this._lastReportedState) return;
    this._lastReportedState = state;
    this.stateHistory.push({ state, at: Date.now() });
    if (this.stateHistory.length > 12) this.stateHistory.shift();
    if (typeof this.hooks.onStateChange === 'function') {
      this.hooks.onStateChange({ name: this.name, state, at: new Date().toISOString() });
    }
  }

  _connect() {
    this.state = STATE.CONNECTING;
    this.socket = io(this.cfg.SERVER_URL, {
      query: { type: 'player' },
      reconnection: false,
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this._reconnecting = false;
      this.reconnectDelay = this.cfg.RECONNECT_BASE_DELAY_MS;
      this.log.info('Conectado ao servidor, entrando no jogo...');
      this.socket.emit('respawn');
    });

    this.socket.on('welcome', (playerSettings, gameSizes) => {
      this.gameWidth = gameSizes.width;
      this.gameHeight = gameSizes.height;

      if (!this._sweepPath) {
        this._sweepPath = buildSweepPath(
          this.gameWidth, this.gameHeight,
          this.cfg.EXPLORE_CELL_WIDTH, this.cfg.EXPLORE_CELL_HEIGHT
        );
        this._sweepIndex = Math.floor((this._sweepPath.length / this.swarmSize) * this.swarmIndex);
        this._sweepLastAdvanceAt = Date.now();
      }

      const player = playerSettings;
      player.name = this.name;
      player.screenWidth = this.cfg.BOT_SCREEN_WIDTH || 1920;
      player.screenHeight = this.cfg.BOT_SCREEN_HEIGHT || 1080;
      player.target = { x: 0, y: 0 };

      this.socket.emit('gotit', player);
      this.alive = true;
      this.state = STATE.EXPLORING;
      this._pendingSacrificeMass = null;
      this.bornAt = Date.now();
      this.feedReadyAt = null;
      this.respawns += 1;
      this.log.info('Entrou no mapa.');
      this._pushStateHistory(STATE.EXPLORING);

      if (!this._loopHandle) {
        // Fase inicial: cada bot no swarm atrasa (index/size)*TICK_MS
        // e continua com setInterval — o start escalonado + fase mantêm dessync.
        const phase = (this.swarmIndex / this.swarmSize) * this.cfg.TICK_MS;
        this._loopHandle = setTimeout(() => {
          this._tick();
          this._loopHandle = setInterval(() => this._tick(), this.cfg.TICK_MS);
        }, phase);
      }
    });

    this.socket.on('serverTellPlayerMove', (playerData, visiblePlayers, foodsList) => {
      this.self = playerData;
      this.users = visiblePlayers;
      this.visibleFoodCount = foodsList ? foodsList.length : 0;
    });

    this.socket.on('RIP', () => {
      const delivered = this._pendingSacrificeMass;
      this.alive = false;
      this.state = STATE.DEAD;
      this.deaths += 1;
      this._pushStateHistory(STATE.DEAD);

      if (delivered != null) {
        this.totalMassSacrificed += delivered;
        this.sacrificeEvents += 1;
        this.log.info(
          `SACRIFÍCIO CONCLUÍDO — massa entregue≈${Math.round(delivered)} | ` +
          `total histórico=${Math.round(this.totalMassSacrificed)} (${this.sacrificeEvents}x)`
        );
        if (typeof this.hooks.onSacrificeComplete === 'function') {
          this.hooks.onSacrificeComplete({
            name: this.name,
            mass: delivered,
            at: new Date().toISOString(),
          });
        }
        this._pendingSacrificeMass = null;
      } else {
        this.log.warn('Bot morreu, respawn automático em breve...');
      }

      if (typeof this.hooks.onDeath === 'function') {
        this.hooks.onDeath({ name: this.name, wasSacrificing: delivered != null });
      }

      setTimeout(() => {
        if (this.socket && this.connected && !this._stopping) this.socket.emit('respawn');
      }, this.cfg.RESPAWN_DELAY_MS);
    });

    this.socket.on('kick', (reason) => {
      this.log.error('Kickado do servidor:', reason);
    });

    this.socket.on('disconnect', () => this._handleDrop('disconnect'));
    this.socket.on('connect_error', (err) => this._handleDrop('connect_error: ' + err.message));
  }

  _handleDrop(reason) {
    if (this._stopping) return;
    if (this._reconnecting) return;
    this._reconnecting = true;
    this.connected = false;
    this.alive = false;
    if (this._loopHandle) {
      clearInterval(this._loopHandle);
      clearTimeout(this._loopHandle);
      this._loopHandle = null;
    }
    this.log.warn(`Conexão perdida/falhou (${reason}). Reconectando em ${this.reconnectDelay}ms...`);
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnecting = false;
      if (this._stopping) return;
      this._connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.cfg.RECONNECT_MAX_DELAY_MS);
  }

  _tick() {
    if (!this.alive || !this.self || !this.self.cells || this.self.cells.length === 0) return;

    const selfPos = { x: this.self.x, y: this.self.y };
    const selfMainCell = this._biggestCell(this.self.cells);

    // Métricas: tempo até massa de alimentação
    if (
      this.bornAt &&
      !this.feedReadyAt &&
      selfMainCell.mass >= this.cfg.MIN_FEED_CELL_MASS
    ) {
      this.feedReadyAt = Date.now();
    }

    // Reporta massa do alvo quando visível (série pro gráfico)
    const targetEarly = this._findTarget();
    if (targetEarly && typeof this.hooks.onTargetMass === 'function') {
      const tc = this._biggestCell(targetEarly.cells);
      this.hooks.onTargetMass({ mass: Math.round(tc.mass) });
    }

    // Pausa / freeze: permanece conectado, heartbeat parado (sem agir)
    if (this.paused || this.frozen) {
      this._sendMovement(selfPos, { x: 0, y: 0 });
      return;
    }

    const target = targetEarly;
    const threat = this._findNearestThreat(selfPos, selfMainCell, target);

    let moveVector;
    const prevState = this.state;

    if (threat && threat.distance < this.cfg.FLEE_DISTANCE) {
      if (this.state === STATE.SACRIFICING) {
        this._abortSacrifice('threat_nearby', null);
      }
      this.state = STATE.EVADING;
      moveVector = geo.direction(threat.pos, selfPos);
    } else if (target) {
      moveVector = this._behaveTowardTarget(selfPos, selfMainCell, target);
    } else {
      if (this.state === STATE.SACRIFICING) {
        this._abortSacrifice('target_lost', null);
      }
      moveVector = this._behaveExploring(selfPos);
    }

    if (this.state !== prevState) {
      this._pushStateHistory(this.state);
    }

    this._sendMovement(selfPos, moveVector);
  }

  _behaveTowardTarget(selfPos, selfMainCell, target) {
    const targetCell = this._biggestCell(target.cells);
    const targetPos = { x: targetCell.x, y: targetCell.y };
    const d = geo.distance(selfPos, targetPos);
    const safeDist = targetCell.radius + selfMainCell.radius + this.cfg.MIN_SAFE_DISTANCE;

    // --- Modo sacrifício: reavaliar a CADA tick ---
    let sacrificeCheck = this._evaluateSacrifice(targetCell, selfMainCell);
    if (this.forceSacrificeOverride && this.cfg.FEEDING_MODE !== 'trickle') {
      // Demo/teste: ignora massa mínima do bot, mantém checagem de segurança vs alvo
      const relaxed = evaluateSacrificeSafety({
        targetMass: targetCell.mass,
        botMass: selfMainCell.mass,
        safetyMargin: this.cfg.SACRIFICE_SAFETY_MARGIN,
        minBotMass: 0,
        feedingMode: this.cfg.FEEDING_MODE === 'trickle' ? 'hybrid' : this.cfg.FEEDING_MODE,
      });
      sacrificeCheck = relaxed;
    }

    if (this.cfg.FEEDING_MODE !== 'trickle' && sacrificeCheck.ok) {
      if (this.forceSacrificeOverride) this.forceSacrificeOverride = false;
      return this._behaveSacrificing(selfPos, targetPos, selfMainCell, sacrificeCheck);
    }

    if (this.state === STATE.SACRIFICING) {
      this._abortSacrifice(sacrificeCheck.reason || 'unsafe', sacrificeCheck.audit);
    }

    if (this.cfg.FEEDING_MODE === 'sacrifice') {
      // Só sacrifica — sem massa/folga, explora/aproxima sem soltar W
      if (d > this.cfg.APPROACH_DISTANCE) {
        this.state = STATE.APPROACHING;
        return geo.direction(selfPos, targetPos);
      }
      this.state = STATE.PREPARING;
      return this._behaveExploring(selfPos);
    }

    // trickle / hybrid (quando não pode sacrificar): comportamento clássico
    if (d > this.cfg.APPROACH_DISTANCE) {
      this.state = STATE.APPROACHING;
      return geo.direction(selfPos, targetPos);
    }

    if (selfMainCell.mass < this.cfg.MIN_FEED_CELL_MASS) {
      this.state = STATE.PREPARING;
      return this._behaveExploring(selfPos);
    }

    this.state = STATE.FEEDING;
    this._tryFeed(selfMainCell, d, safeDist);
    // Split só no trickle: em hybrid/sacrifice células menores atrapalham o engolir completo
    if (this.cfg.FEEDING_MODE === 'trickle') {
      this._trySplitToFeedFaster(d);
    }

    if (d < safeDist) {
      return geo.direction(targetPos, selfPos);
    }
    if (d > safeDist + 40) {
      return geo.direction(selfPos, targetPos);
    }
    return geo.direction(selfPos, targetPos);
  }

  _behaveSacrificing(selfPos, targetPos, selfMainCell, sacrificeCheck) {
    const entering = this.state !== STATE.SACRIFICING;
    this.state = STATE.SACRIFICING;
    this._pendingSacrificeMass = selfMainCell.mass;
    this._lastSacrificeAudit = sacrificeCheck.audit;

    if (entering) {
      this._logSacrificeAudit('INICIANDO SACRIFÍCIO', sacrificeCheck.audit);
      if (typeof this.hooks.onSacrificeAttempt === 'function') {
        this.hooks.onSacrificeAttempt({
          name: this.name,
          audit: sacrificeCheck.audit,
          at: new Date().toISOString(),
        });
      }
    }

    // Direto no centro — sem órbita / sem distância segura
    return geo.direction(selfPos, targetPos);
  }

  _abortSacrifice(reason, audit) {
    this.log.warn(
      `SACRIFÍCIO ABORTADO (${reason})` +
      (audit
        ? ` | alvo=${audit.targetMass} bot=${audit.botMass} precisa≥${audit.requiredTargetMass} razão=${audit.actualRatio}`
        : '')
    );
    this._pendingSacrificeMass = null;
    if (typeof this.hooks.onSacrificeAbort === 'function') {
      this.hooks.onSacrificeAbort({ name: this.name, reason, audit, at: new Date().toISOString() });
    }
  }

  _evaluateSacrifice(targetCell, selfMainCell) {
    return evaluateSacrificeSafety({
      targetMass: targetCell.mass,
      botMass: selfMainCell.mass,
      safetyMargin: this.cfg.SACRIFICE_SAFETY_MARGIN,
      minBotMass: this.cfg.SACRIFICE_MIN_BOT_MASS,
      feedingMode: this.cfg.FEEDING_MODE,
    });
  }

  _logSacrificeAudit(label, audit) {
    this.log.info(
      `${label} | alvo.mass=${audit.targetMass} bot.mass=${audit.botMass} | ` +
      `razão_servidor=${audit.serverEatRatioEquiv} margem=${audit.safetyMargin} | ` +
      `precisa_alvo≥${audit.requiredTargetMass} | razão_atual=${audit.actualRatio} | ` +
      `ok_alvo_come_bot=${audit.wouldTargetEatBot} | perigo_bot_come_alvo=${audit.wouldBotEatTarget} | ` +
      `fórmula=${audit.formula}`
    );
  }

  _behaveExploring(selfPos) {
    this.state = STATE.EXPLORING;
    if (!this._sweepPath || this._sweepPath.length === 0) {
      return { x: 0, y: 0 };
    }

    const now = Date.now();
    const currentPoint = this._sweepPath[this._sweepIndex % this._sweepPath.length];
    const reached = geo.distance(selfPos, currentPoint) < this.cfg.EXPLORE_CELL_REACHED_DIST;
    const stuck = now - this._sweepLastAdvanceAt > this.cfg.EXPLORE_STUCK_TIMEOUT_MS;

    if (reached || stuck) {
      this._sweepIndex = (this._sweepIndex + 1) % this._sweepPath.length;
      this._sweepLastAdvanceAt = now;
    }

    const nextPoint = this._sweepPath[this._sweepIndex % this._sweepPath.length];
    return geo.direction(selfPos, nextPoint);
  }

  _tryFeed(selfMainCell, distanceToTarget, safeDist) {
    const now = Date.now();
    if (now - this.lastFeedAt < this.cfg.FEED_COOLDOWN_MS) return;
    if (distanceToTarget < this.cfg.MIN_SAFE_DISTANCE * 0.6) return;
    if (distanceToTarget > this.cfg.FEED_DISTANCE + safeDist) return;
    if (selfMainCell.mass < this.cfg.MIN_FEED_CELL_MASS) return;

    this.socket.emit('1');
    this.lastFeedAt = now;
    this.trickleShots += 1;
    this.trickleMassDelivered += this.cfg.FIRE_FOOD_MASS || 20;
    if (typeof this.hooks.onFeed === 'function') {
      this.hooks.onFeed({
        name: this.name,
        mass: this.cfg.FIRE_FOOD_MASS || 20,
        at: new Date().toISOString(),
      });
    }
  }

  _trySplitToFeedFaster(distanceToTarget) {
    const now = Date.now();
    if (now - this.lastSplitAt < 3000) return;
    if (this.self.cells.length > 1) return;
    if (this.self.massTotal < this.cfg.MIN_MASS_TO_SPLIT_FEED) return;
    if (distanceToTarget > this.cfg.APPROACH_DISTANCE) return;

    this.socket.emit('2');
    this.lastSplitAt = now;
    this.log.info('Split para acelerar a alimentação (massa alta o suficiente).');
  }

  _sendMovement(selfPos, unitVector) {
    const target = geo.scale(unitVector, 1000);
    this.socket.emit('0', target);
  }

  _findTarget() {
    const wanted = this.cfg.TARGET_PLAYER_NAME.toLowerCase();
    return this.users.find(
      (p) => p.name && p.name.toLowerCase() === wanted && p.id !== this.self.id
    ) || null;
  }

  /**
   * Ameaças = outros jogadores maiores que o bot.
   * O ALVO é sempre excluído — senão o bot "fugiria" de quem deve alimentar.
   */
  _findNearestThreat(selfPos, selfMainCell, target) {
    let nearest = null;
    const targetId = target ? target.id : null;
    const ignorePrefix = (this.cfg.IGNORE_THREAT_NAME_PREFIX || '').toLowerCase();
    for (const player of this.users) {
      if (player.id === this.self.id) continue;
      if (targetId && player.id === targetId) continue;
      if (
        target &&
        player.name &&
        player.name.toLowerCase() === this.cfg.TARGET_PLAYER_NAME.toLowerCase()
      ) {
        continue;
      }
      if (
        ignorePrefix &&
        player.name &&
        player.name.toLowerCase().startsWith(ignorePrefix)
      ) {
        continue;
      }
      for (const cell of player.cells) {
        if (cell.mass < selfMainCell.mass * this.cfg.THREAT_MASS_RATIO) continue;
        const d = geo.distance(selfPos, { x: cell.x, y: cell.y });
        if (d > this.cfg.THREAT_SCAN_RADIUS) continue;
        if (!nearest || d < nearest.distance) {
          nearest = { pos: { x: cell.x, y: cell.y }, distance: d, name: player.name };
        }
      }
    }
    return nearest;
  }

  _biggestCell(cells) {
    return cells.reduce((a, b) => (a.mass >= b.mass ? a : b));
  }

  getStatus() {
    const target = this.self ? this._findTarget() : null;
    let targetDist = null;
    if (target && this.self) {
      targetDist = Math.round(geo.distance({ x: this.self.x, y: this.self.y }, { x: target.x, y: target.y }));
    }
    return {
      name: this.name,
      connected: this.connected,
      alive: this.alive,
      state: this.state,
      paused: this.paused,
      frozen: this.frozen,
      mass: this.self ? Math.round(this.self.massTotal || 0) : 0,
      x: this.self ? Math.round(this.self.x) : null,
      y: this.self ? Math.round(this.self.y) : null,
      cells: this.self ? this.self.cells.length : 0,
      targetVisible: !!target,
      targetDist,
      visibleFood: this.visibleFoodCount || 0,
      totalMassSacrificed: Math.round(this.totalMassSacrificed),
      sacrificeEvents: this.sacrificeEvents,
      lastSacrificeAudit: this._lastSacrificeAudit,
      deaths: this.deaths,
      respawns: this.respawns,
      trickleShots: this.trickleShots,
      trickleMassDelivered: Math.round(this.trickleMassDelivered),
      msToFeedReady: this.bornAt && this.feedReadyAt ? (this.feedReadyAt - this.bornAt) : null,
      stateHistory: this.stateHistory.slice(),
      forceSacrificeOverride: this.forceSacrificeOverride,
    };
  }
}

module.exports = { FeederBot, STATE };
