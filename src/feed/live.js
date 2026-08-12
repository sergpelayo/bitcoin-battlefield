import { Emitter } from '../lib/emitter.js';
import { OrderBook } from '../lib/orderbook.js';

/**
 * Feed en vivo de Binance (API pública, sin API key).
 *
 *   <symbol>@depth@100ms  -> diffs del order book (+ snapshot REST para sincronizar)
 *   <symbol>@aggTrade     -> trades agregados (quién ataca: comprador o vendedor)
 *   <symbol>@ticker       -> estadísticas 24h
 *
 * Eventos: 'book' | 'trade' | 'ticker' | 'up' | 'down'
 */

// binance.vision va primero a propósito: sirve los mismos streams de market data
// pero sin el geobloqueo por IP de binance.com. Con el sitio publicado, un visitante
// desde una región bloqueada se comería 25 s de datos simulados antes de que la
// rotación de endpoints llegara al segundo. Cuesta ~0,5 s más de latencia inicial;
// a cambio, la primera conexión funciona desde cualquier país.
const ENDPOINTS = [
  { ws: 'wss://data-stream.binance.vision:9443', rest: 'https://data-api.binance.vision' },
  { ws: 'wss://stream.binance.com:9443', rest: 'https://api.binance.com' },
];

const SNAPSHOT_LIMIT = 5000;
const HANDSHAKE_TIMEOUT = 12_000; // sin libro listo en este tiempo -> fallamos
const STALE_TIMEOUT = 20_000; // sin mensajes en este tiempo -> reconectamos

export class LiveFeed extends Emitter {
  constructor(symbol = 'BTCUSDT') {
    super();
    this.symbol = symbol.toUpperCase();
    this.stream = symbol.toLowerCase();
    this.book = new OrderBook();
    this.running = false;

    this._ws = null;
    this._endpoint = 0;
    this._buffer = [];
    this._syncing = false;
    this._lastMessageAt = 0;
    this._timers = [];
    this._watchdog = null;
    this._abort = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._connect();
  }

  stop() {
    this.running = false;
    this._teardown();
    this.book.reset();
  }

  _teardown() {
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    clearInterval(this._watchdog);
    this._watchdog = null;
    this._abort?.abort();
    this._abort = null;
    if (this._ws) {
      this._ws.onopen = this._ws.onmessage = this._ws.onerror = this._ws.onclose = null;
      try {
        this._ws.close();
      } catch {
        /* noop */
      }
      this._ws = null;
    }
    this._buffer = [];
    this._syncing = false;
  }

  _fail(reason) {
    if (!this.running) return;
    // Nos marcamos como parados para que un start() posterior (el reintento del
    // MarketFeed) vuelva a conectar en vez de salir por el guard de start().
    this.running = false;
    this._teardown();
    this.book.reset();
    this._endpoint = (this._endpoint + 1) % ENDPOINTS.length;
    this.emit('down', { reason });
  }

  _connect() {
    const { ws: wsBase } = ENDPOINTS[this._endpoint];
    const s = this.stream;
    const url = `${wsBase}/stream?streams=${s}@depth@100ms/${s}@aggTrade/${s}@ticker`;

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this._fail(`no se pudo abrir el WebSocket: ${err.message}`);
      return;
    }
    this._ws = ws;
    this._lastMessageAt = performance.now();

    // Si el libro no queda sincronizado a tiempo, damos la conexión por perdida.
    this._timers.push(
      setTimeout(() => {
        if (this.running && !this.book.ready) this._fail('timeout de sincronización');
      }, HANDSHAKE_TIMEOUT),
    );

    // Vigilante de conexión zombie.
    this._watchdog = setInterval(() => {
      if (!this.running) return;
      if (performance.now() - this._lastMessageAt > STALE_TIMEOUT) {
        this._fail('sin datos (conexión inactiva)');
      }
    }, 4000);

    ws.onopen = () => this._resync();
    ws.onerror = () => {
      /* onclose se encarga; evitamos duplicar el fallo */
    };
    ws.onclose = () => {
      if (this.running) this._fail('conexión cerrada');
    };
    ws.onmessage = (evt) => {
      this._lastMessageAt = performance.now();
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      const data = msg.data;
      if (!data) return;

      switch (data.e) {
        case 'depthUpdate':
          this._onDepth(data);
          break;
        case 'aggTrade':
          this.emit('trade', {
            price: parseFloat(data.p),
            qty: parseFloat(data.q),
            // m = true -> el comprador era maker -> el agresor es un vendedor (oso).
            isBuy: data.m === false,
            time: data.T,
          });
          break;
        case '24hrTicker':
          this.emit('ticker', {
            last: parseFloat(data.c),
            changePct: parseFloat(data.P),
            change: parseFloat(data.p),
            high: parseFloat(data.h),
            low: parseFloat(data.l),
            volBase: parseFloat(data.v),
            volQuote: parseFloat(data.q),
          });
          break;
      }
    };
  }

  async _resync() {
    if (this._syncing) return;
    this._syncing = true;
    this.book.reset();
    this._buffer = [];

    const { rest } = ENDPOINTS[this._endpoint];
    this._abort = new AbortController();
    try {
      const res = await fetch(
        `${rest}/api/v3/depth?symbol=${this.symbol}&limit=${SNAPSHOT_LIMIT}`,
        { signal: this._abort.signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const snapshot = await res.json();
      if (!this.running || this._ws?.readyState !== WebSocket.OPEN) return;

      this.book.applySnapshot(snapshot);

      // Reproducimos los diffs que llegaron mientras pedíamos el snapshot.
      const pending = this._buffer;
      this._buffer = [];
      for (const ev of pending) {
        if (ev.u <= snapshot.lastUpdateId) continue;
        if (!this.book.applyDiff(ev)) {
          this._syncing = false;
          return this._resync();
        }
      }
      this._syncing = false;
      this.emit('book', this.book);
    } catch (err) {
      this._syncing = false;
      if (err.name === 'AbortError') return;
      this._fail(`snapshot REST falló: ${err.message}`);
    }
  }

  _onDepth(ev) {
    if (!this.book.ready) {
      this._buffer.push(ev);
      if (this._buffer.length > 2000) this._buffer.shift();
      return;
    }
    if (!this.book.applyDiff(ev)) {
      this._resync();
      return;
    }
    this.emit('book', this.book);
  }
}
