import { Emitter } from '../lib/emitter.js';
import { OrderBook } from '../lib/orderbook.js';

/**
 * Feed simulado. Se activa cuando Binance no está disponible (geobloqueo, red caída,
 * CORS, offline...) para que la app siempre tenga algo que renderizar.
 *
 * Emite exactamente los mismos eventos que LiveFeed y mantiene un OrderBook real,
 * así que el resto de la aplicación no distingue entre uno y otro.
 */

const STEP = 2; // dólares por nivel del libro simulado
const LEVELS = 450; // ±900 USD alrededor del mid
const TICK_MS = 100;
const DEFAULT_PRICE = 96_000;

export class SimFeed extends Emitter {
  constructor(seedPrice) {
    super();
    this.book = new OrderBook();
    this.running = false;

    this.price = seedPrice && Number.isFinite(seedPrice) ? seedPrice : DEFAULT_PRICE;
    this.openPrice = this.price;
    this.high = this.price;
    this.low = this.price;
    this.volBase = 1200 + Math.random() * 900;
    this.drift = 0;

    this.bidQty = new Float64Array(LEVELS);
    this.askQty = new Float64Array(LEVELS);
    /** @type {{side:number, index:number, size:number, life:number}[]} */
    this.walls = [];

    this._seedDepth();
    this._timers = [];
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._timers.push(setInterval(() => this._tick(), TICK_MS));
    this._timers.push(setInterval(() => this._emitTicker(), 1000));
    this._tick();
    this._emitTicker();
  }

  stop() {
    this.running = false;
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
  }

  _seedDepth() {
    for (let i = 0; i < LEVELS; i++) {
      this.bidQty[i] = this._baseQty(i);
      this.askQty[i] = this._baseQty(i);
    }
    for (let i = 0; i < 6; i++) this._spawnWall();
  }

  /** Perfil de liquidez: poco pegado al mid, creciendo hacia fuera. */
  _baseQty(i) {
    const shape = 0.35 + 1.9 * (1 - Math.exp(-i / 55));
    return shape * (0.55 + Math.random() * 0.9);
  }

  _spawnWall() {
    this.walls.push({
      side: Math.random() < 0.5 ? 0 : 1, // 0 = bids, 1 = asks
      index: Math.floor(Math.pow(Math.random(), 0.7) * LEVELS),
      size: 6 + Math.random() * 26,
      life: 1,
      decay: 0.0015 + Math.random() * 0.004,
      width: 1 + Math.floor(Math.random() * 4),
    });
  }

  _tick() {
    // --- Precio: random walk con algo de momentum ---
    this.drift = this.drift * 0.985 + (Math.random() - 0.5) * 0.9;
    const vol = this.price * 0.00018;
    this.price = Math.max(1, this.price + this.drift * vol + (Math.random() - 0.5) * vol * 3);
    this.high = Math.max(this.high, this.price);
    this.low = Math.min(this.low, this.price);

    // --- Profundidad: ruido con reversión a la media + paredes que aparecen y se comen ---
    for (let i = 0; i < LEVELS; i++) {
      const target = this._baseQty(i);
      this.bidQty[i] += (target - this.bidQty[i]) * 0.02 + (Math.random() - 0.5) * 0.12;
      this.askQty[i] += (target - this.askQty[i]) * 0.02 + (Math.random() - 0.5) * 0.12;
      if (this.bidQty[i] < 0.01) this.bidQty[i] = 0.01;
      if (this.askQty[i] < 0.01) this.askQty[i] = 0.01;
    }

    if (Math.random() < 0.012) this._spawnWall();
    for (let w = this.walls.length - 1; w >= 0; w--) {
      const wall = this.walls[w];
      // Las paredes cerca del mid se consumen más rápido, como en un libro real.
      wall.life -= wall.decay * (1 + 3 / (1 + wall.index * 0.15));
      if (wall.life <= 0) this.walls.splice(w, 1);
    }

    this._rebuildBook();
    this.emit('book', this.book);

    // --- Trades: ráfagas cortas, sesgadas por el momentum ---
    const bias = 0.5 + Math.max(-0.35, Math.min(0.35, this.drift * 0.25));
    const n = Math.random() < 0.35 ? 1 + Math.floor(Math.random() * 3) : 0;
    for (let i = 0; i < n; i++) {
      const isBuy = Math.random() < bias;
      const qty = Math.exp(Math.random() * 3.6 - 5.2); // ~0.005 - 0.2 BTC, con cola larga
      this.volBase += qty;
      this.emit('trade', {
        price: this.price + (isBuy ? STEP / 2 : -STEP / 2),
        qty,
        isBuy,
        time: performance.now(),
      });
    }
  }

  _rebuildBook() {
    // Las paredes se aplican como capa encima del ruido base, nunca sobre los
    // arrays base: si se acumulasen ahí la reversión a la media no las contendría.
    const bidOverlay = new Float64Array(LEVELS);
    const askOverlay = new Float64Array(LEVELS);
    for (const wall of this.walls) {
      const overlay = wall.side === 0 ? bidOverlay : askOverlay;
      for (let k = -wall.width; k <= wall.width; k++) {
        const idx = wall.index + k;
        if (idx < 0 || idx >= LEVELS) continue;
        const falloff = 1 - Math.abs(k) / (wall.width + 1);
        overlay[idx] += wall.size * wall.life * falloff;
      }
    }

    const { bids, asks } = this.book;
    bids.clear();
    asks.clear();
    const mid = this.price;
    const half = STEP / 2;
    for (let i = 0; i < LEVELS; i++) {
      const bidPrice = Math.round((mid - half - i * STEP) * 100) / 100;
      const askPrice = Math.round((mid + half + i * STEP) * 100) / 100;
      bids.set(bidPrice, this.bidQty[i] + bidOverlay[i]);
      asks.set(askPrice, this.askQty[i] + askOverlay[i]);
    }
    this.book.lastUpdateId++;
    this.book.ready = true;
  }

  _emitTicker() {
    const change = this.price - this.openPrice;
    this.emit('ticker', {
      last: this.price,
      change,
      changePct: (change / this.openPrice) * 100,
      high: this.high,
      low: this.low,
      volBase: this.volBase,
      volQuote: this.volBase * this.price,
    });
  }
}
