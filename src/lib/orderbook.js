/**
 * Order book local (estilo Binance): snapshot REST + eventos diff por WebSocket.
 * También lo usa el feed simulado, para que el resto de la app no note la diferencia.
 */
export class OrderBook {
  constructor() {
    /** @type {Map<number, number>} precio -> cantidad */
    this.bids = new Map();
    /** @type {Map<number, number>} precio -> cantidad */
    this.asks = new Map();
    this.lastUpdateId = 0;
    this.ready = false;
  }

  reset() {
    this.bids.clear();
    this.asks.clear();
    this.lastUpdateId = 0;
    this.ready = false;
  }

  /** snapshot = { lastUpdateId, bids: [[precio, cantidad], ...], asks: [...] } */
  applySnapshot(snapshot) {
    this.bids.clear();
    this.asks.clear();
    for (const [p, q] of snapshot.bids) this._set(this.bids, p, q);
    for (const [p, q] of snapshot.asks) this._set(this.asks, p, q);
    this.lastUpdateId = snapshot.lastUpdateId;
    this.ready = true;
  }

  /**
   * Aplica un evento diff de `<symbol>@depth`.
   * Devuelve false si detecta un hueco en la secuencia (hay que re-sincronizar).
   */
  applyDiff(ev) {
    // U = primer updateId del evento, u = último.
    if (ev.u <= this.lastUpdateId) return true; // evento viejo, se ignora
    if (this.lastUpdateId && ev.U > this.lastUpdateId + 1) return false; // hueco

    for (const [p, q] of ev.b) this._set(this.bids, p, q);
    for (const [p, q] of ev.a) this._set(this.asks, p, q);
    this.lastUpdateId = ev.u;
    return true;
  }

  _set(map, price, qty) {
    const p = typeof price === 'number' ? price : parseFloat(price);
    const q = typeof qty === 'number' ? qty : parseFloat(qty);
    if (!Number.isFinite(p) || !Number.isFinite(q)) return;
    if (q <= 0) map.delete(p);
    else map.set(p, q);
  }

  /** Mejor bid / mejor ask por escaneo directo (el libro cabe de sobra en memoria). */
  best() {
    let bid = -Infinity;
    let ask = Infinity;
    for (const p of this.bids.keys()) if (p > bid) bid = p;
    for (const p of this.asks.keys()) if (p < ask) ask = p;
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
    return { bid, ask, mid: (bid + ask) / 2, spread: ask - bid };
  }

  /**
   * Agrupa el libro en `bins` cubos de `binSize` dólares a cada lado del mid.
   * Sin esto el top del libro de BTCUSDT abarca centavos y no se ve nada.
   * bidBins[0] es el cubo pegado al mid; bidBins[n-1] el más lejano.
   */
  bucketize(mid, binSize, bins) {
    const bidBins = new Float64Array(bins);
    const askBins = new Float64Array(bins);
    // En dólares nocionales (precio x cantidad), que es lo que las tropas
    // representan. No vale multiplicar la cantidad por el mid al final: cada
    // nivel se valora a SU precio, y en las paredes lejanas eso ya no da igual.
    const bidUsd = new Float64Array(bins);
    const askUsd = new Float64Array(bins);
    // Liquidez que existe pero cae fuera del campo: la reserva que vuela arriba.
    let bidOutUsd = 0;
    let askOutUsd = 0;

    for (const [p, q] of this.bids) {
      const d = mid - p;
      if (d < 0) continue;
      const i = Math.floor(d / binSize);
      if (i < bins) {
        bidBins[i] += q;
        bidUsd[i] += p * q;
      } else {
        bidOutUsd += p * q;
      }
    }
    for (const [p, q] of this.asks) {
      const d = p - mid;
      if (d < 0) continue;
      const i = Math.floor(d / binSize);
      if (i < bins) {
        askBins[i] += q;
        askUsd[i] += p * q;
      } else {
        askOutUsd += p * q;
      }
    }

    let bidVol = 0;
    let askVol = 0;
    let maxQty = 0;
    let bidUsdTotal = 0;
    let askUsdTotal = 0;
    let maxUsd = 0;
    for (let i = 0; i < bins; i++) {
      bidVol += bidBins[i];
      askVol += askBins[i];
      bidUsdTotal += bidUsd[i];
      askUsdTotal += askUsd[i];
      if (bidBins[i] > maxQty) maxQty = bidBins[i];
      if (askBins[i] > maxQty) maxQty = askBins[i];
      if (bidUsd[i] > maxUsd) maxUsd = bidUsd[i];
      if (askUsd[i] > maxUsd) maxUsd = askUsd[i];
    }

    return {
      bidBins,
      askBins,
      bidUsd,
      askUsd,
      bidOutUsd,
      askOutUsd,
      bidUsdTotal,
      askUsdTotal,
      bidVol,
      askVol,
      maxQty,
      maxUsd,
      binSize,
      mid,
    };
  }
}

/** Tamaño de cubo "bonito" para que el campo cubra ~±0.5% del precio. */
export function niceBinSize(mid) {
  const target = mid * 0.00025;
  const steps = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500];
  let best = steps[0];
  for (const s of steps) {
    if (Math.abs(s - target) < Math.abs(best - target)) best = s;
  }
  return best;
}
