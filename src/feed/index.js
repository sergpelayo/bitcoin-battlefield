import { Emitter } from '../lib/emitter.js';
import { LiveFeed } from './live.js';
import { SimFeed } from './sim.js';

const RETRY_MS = 25_000;

/**
 * Orquesta el feed en vivo y el simulado.
 *
 * - Arranca intentando Binance.
 * - Si falla (o si se cae más tarde), levanta el simulador al instante para que
 *   la escena nunca se quede sin datos, y sigue reintentando la conexión real.
 * - Cuando Binance vuelve, corta el simulador y retoma los datos reales.
 *
 * Eventos: 'book' | 'trade' | 'ticker' | 'status'
 */
export class MarketFeed extends Emitter {
  constructor(symbol = 'BTCUSDT') {
    super();
    this.symbol = symbol;
    this.source = 'connecting'; // 'live' | 'sim' | 'connecting'
    this.lastPrice = null;

    this.live = new LiveFeed(symbol);
    this.sim = null;
    this._retryTimer = null;

    this.live.on('book', (book) => {
      if (this.source !== 'live') this._promoteLive();
      this.emit('book', book);
    });
    this.live.on('trade', (t) => {
      if (this.source !== 'live') return;
      this.lastPrice = t.price;
      this.emit('trade', t);
    });
    this.live.on('ticker', (t) => {
      if (this.source !== 'live') return;
      this.lastPrice = t.last;
      this.emit('ticker', t);
    });
    this.live.on('down', ({ reason }) => this._fallback(reason));
  }

  start() {
    this._setStatus('connecting', 'conectando con binance…');
    this.live.start();
    // Si en 6 s todavía no hay datos reales, mostramos algo mientras tanto.
    this._bootTimer = setTimeout(() => {
      if (this.source === 'connecting') this._fallback('conexión lenta');
    }, 6000);
  }

  stop() {
    clearTimeout(this._bootTimer);
    clearTimeout(this._retryTimer);
    this.live.stop();
    this._stopSim();
  }

  _promoteLive() {
    clearTimeout(this._bootTimer);
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
    this._stopSim();
    this._setStatus('live', 'binance · en vivo');
  }

  _fallback(reason) {
    clearTimeout(this._bootTimer);
    if (!this.sim) {
      this.sim = new SimFeed(this.lastPrice);
      this.sim.on('book', (book) => this.source === 'sim' && this.emit('book', book));
      this.sim.on('trade', (t) => {
        if (this.source !== 'sim') return;
        this.lastPrice = t.price;
        this.emit('trade', t);
      });
      this.sim.on('ticker', (t) => {
        if (this.source !== 'sim') return;
        this.lastPrice = t.last;
        this.emit('ticker', t);
      });
      this.sim.start();
    }
    this._setStatus('sim', `datos simulados · ${reason}`);

    // Seguimos intentando volver a los datos reales.
    if (!this._retryTimer) {
      this._retryTimer = setTimeout(() => {
        this._retryTimer = null;
        if (this.source === 'sim') this.live.start();
      }, RETRY_MS);
    }
  }

  _stopSim() {
    if (!this.sim) return;
    this.sim.stop();
    this.sim.clear();
    this.sim = null;
  }

  _setStatus(source, detail) {
    this.source = source;
    this.emit('status', { source, detail });
  }
}
