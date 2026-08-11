import { MarketFeed } from './feed/index.js';
import { niceBinSize } from './lib/orderbook.js';
import { Battlefield } from './scene/battlefield.js';
import { BINS } from './scene/field.js';
import { Hud } from './hud.js';

const canvas = document.getElementById('scene');
const battlefield = new Battlefield(canvas);
const hud = new Hud();

// ---------------------------------------------------------------- datos ----
const feed = new MarketFeed('BTCUSDT');

feed.on('status', ({ source, detail }) => hud.setStatus(source, detail));
feed.on('ticker', (t) => hud.setTicker(t));

feed.on('trade', (t) => {
  battlefield.fireTrade(t);
  // El ticker de 24h llega una vez por segundo; los trades dan el precio al instante.
  hud.setPrice(t.price);
  if (t.qty >= 0.02) hud.pushTrade(t);
});

// El libro cambia hasta 10 veces por segundo: agrupamos y publicamos a ritmo de render.
let pendingBook = null;
feed.on('book', (book) => {
  pendingBook = book;
});

function consumeBook() {
  if (!pendingBook) return;
  const book = pendingBook;
  pendingBook = null;

  const best = book.best();
  if (!best) return;

  const binSize = niceBinSize(best.mid);
  const depth = book.bucketize(best.mid, binSize, BINS);

  battlefield.setDepth(depth);
  battlefield.setMarket(best.mid, binSize);

  // Pared = el tramo más cargado de cada lado, valorado en dólares.
  let maxBid = 0;
  let maxAsk = 0;
  for (let i = 0; i < BINS; i++) {
    if (depth.bidBins[i] > maxBid) maxBid = depth.bidBins[i];
    if (depth.askBins[i] > maxAsk) maxAsk = depth.askBins[i];
  }

  hud.setDepth({
    bidVol: depth.bidVol,
    askVol: depth.askVol,
    spread: best.spread,
    binSize,
    levels: BINS,
    buyWall: maxBid * best.mid,
    sellWall: maxAsk * best.mid,
  });
}

feed.start();

// -------------------------------------------------------------- controles ----
window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') battlefield.resetCamera();
  if (e.key === 'b' || e.key === 'B') {
    const on = !battlefield.bloomEnabled;
    battlefield.setBloom(on);
    hud.setBloom(on);
  }
});

// ------------------------------------------------------------------ loop ----
let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;

function frame(now) {
  requestAnimationFrame(frame);
  // Si la pestaña estuvo en segundo plano, dt puede ser enorme: lo acotamos.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  consumeBook();
  battlefield.update(dt);

  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc >= 0.5) {
    hud.setFps(fpsFrames / fpsAcc);
    fpsAcc = 0;
    fpsFrames = 0;
  }
}
requestAnimationFrame(frame);

// Útil para trastear desde la consola del navegador.
window.__battlefield = { feed, battlefield, hud };
