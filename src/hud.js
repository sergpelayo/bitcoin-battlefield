/**
 * HUD en DOM sobre el canvas. Solo lee datos y pinta: no toca la escena 3D.
 */

const MAX_LOG = 7;

const usd = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usd0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

const fmtBtc = (v) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4));

const fmtCompact = (v) => {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
};

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      status: $('status'),
      statusText: $('status-text'),
      price: $('price'),
      tick: $('tick'),
      change: $('change'),
      high: $('high'),
      low: $('low'),
      vol: $('vol'),
      spread: $('spread'),
      range: $('range'),
      bullPct: $('bull-pct'),
      bearPct: $('bear-pct'),
      pressureFill: $('pressure-fill'),
      bidVol: $('bid-vol'),
      askVol: $('ask-vol'),
      buyWall: $('buy-wall'),
      sellWall: $('sell-wall'),
      fieldUsd: $('field-usd'),
      reserveUsd: $('reserve-usd'),
      verdict: $('verdict'),
      log: $('log'),
      fps: $('fps'),
      bloomState: $('bloom-state'),
    };
    this.lastPrice = null;
    this._flashTimer = null;
  }

  setStatus(source, detail) {
    this.el.status.classList.toggle('is-live', source === 'live');
    this.el.status.classList.toggle('is-sim', source === 'sim');
    this.el.statusText.textContent = detail;
  }

  setPrice(price) {
    if (!Number.isFinite(price)) return;
    const prev = this.lastPrice;
    const dir = prev == null ? 0 : Math.sign(price - prev);
    this.lastPrice = price;
    this.el.price.textContent = `$${usd.format(price)}`;

    if (dir !== 0) {
      const delta = price - prev;
      this.el.tick.textContent = `${delta > 0 ? '▲' : '▼'}${Math.abs(delta).toFixed(2)}`;
      this.el.tick.classList.toggle('up', dir > 0);
      this.el.tick.classList.toggle('down', dir < 0);
      this.el.price.classList.toggle('up', dir > 0);
      this.el.price.classList.toggle('down', dir < 0);
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => {
        this.el.price.classList.remove('up', 'down');
      }, 700);
    }
  }

  setTicker({ last, change, changePct, high, low, volQuote }) {
    this.setPrice(last);
    const up = changePct >= 0;
    this.el.change.textContent = `${up ? '▲' : '▼'} ${up ? '+' : ''}${usd.format(
      change,
    )}  (${up ? '+' : ''}${changePct.toFixed(2)}%)  24H`;
    this.el.change.classList.toggle('up', up);
    this.el.change.classList.toggle('down', !up);

    this.el.high.textContent = `$${usd0.format(high)}`;
    this.el.low.textContent = `$${usd0.format(low)}`;
    this.el.vol.textContent = `$${fmtCompact(volQuote)}`;
  }

  setDepth({
    bidVol,
    askVol,
    spread,
    binSize,
    levels,
    buyWall,
    sellWall,
    bidUsdTotal,
    askUsdTotal,
    reserveBid,
    reserveAsk,
  }) {
    const total = bidVol + askVol;
    const bullPct = total > 0 ? (bidVol / total) * 100 : 50;

    this.el.pressureFill.style.width = `${bullPct.toFixed(2)}%`;
    this.el.bullPct.textContent = `${bullPct.toFixed(1)}%`;
    this.el.bearPct.textContent = `${(100 - bullPct).toFixed(1)}%`;
    this.el.bidVol.textContent = `${fmtBtc(bidVol)} BTC`;
    this.el.askVol.textContent = `${fmtBtc(askVol)} BTC`;
    this.el.buyWall.textContent = `$${fmtCompact(buyWall)}`;
    this.el.sellWall.textContent = `$${fmtCompact(sellWall)}`;
    // Lo que suman las tropas en pantalla, y lo que espera detrás como aviones.
    this.el.fieldUsd.textContent = `$${fmtCompact(bidUsdTotal + askUsdTotal)}`;
    this.el.reserveUsd.textContent = `$${fmtCompact(reserveBid + reserveAsk)}`;

    let verdict = 'CONTESTED';
    let cls = '';
    if (bullPct > 57) {
      verdict = bullPct > 68 ? 'BULLS OVERRUN' : 'BULLS ADVANCING';
      cls = 'bull';
    } else if (bullPct < 43) {
      verdict = bullPct < 32 ? 'BEARS OVERRUN' : 'BEARS ADVANCING';
      cls = 'bear';
    }
    this.el.verdict.textContent = verdict;
    this.el.verdict.className = `verdict ${cls}`;

    this.el.spread.textContent = `$${spread.toFixed(2)}`;
    this.el.range.textContent = `±$${usd0.format(binSize * levels)}`;
  }

  pushTrade({ price, qty, isBuy }) {
    const li = document.createElement('li');
    li.className = isBuy ? 'buy' : 'sell';
    if (qty >= 1) li.classList.add('big');
    li.innerHTML =
      `<span>${isBuy ? '▲ BUY ' : '▼ SELL'}</span>` +
      `<span>${usd.format(price)}</span>` +
      `<span class="qty">${qty.toFixed(4)}</span>`;

    this.el.log.prepend(li);
    while (this.el.log.childElementCount > MAX_LOG) this.el.log.lastElementChild.remove();
  }

  setFps(fps) {
    this.el.fps.textContent = String(Math.round(fps)).padStart(2, '0');
  }

  setBloom(on) {
    this.el.bloomState.textContent = on ? 'ON' : 'OFF';
  }
}
