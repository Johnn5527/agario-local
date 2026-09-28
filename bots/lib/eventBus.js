'use strict';

/**
 * Barramento simples de eventos do painel (terminal + web compartilham).
 */
class EventBus {
  constructor() {
    this._listeners = new Set();
    this.events = [];
    this.maxEvents = 80;
  }

  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  emit(type, detail = {}) {
    const ev = {
      type,
      detail,
      at: new Date().toISOString(),
      ts: Date.now(),
    };
    this.events.push(ev);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    for (const fn of this._listeners) {
      try { fn(ev); } catch (_) { /* ignore */ }
    }
    return ev;
  }

  recent(n = 20) {
    return this.events.slice(-n);
  }
}

module.exports = { EventBus };
