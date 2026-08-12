import { MarketFeed } from './feed/index.js';
import { niceBinSize } from './lib/orderbook.js';
import { Battlefield } from './scene/battlefield.js';
import { BINS } from './scene/field.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Alarms } from './alarms.js';
import { Controls } from './controls.js';
import { License } from './license.js';
import { Watchlist } from './watchlist.js';

const canvas = document.getElementById('scene');
const battlefield = new Battlefield(canvas);
const hud = new Hud();
const audio = new Audio();
const license = new License();
const watchlist = new Watchlist(license);
const alarms = new Alarms(audio, license);
const controls = new Controls(audio, license, watchlist);

// El navegador no deja crear audio hasta que el usuario toca la página: el
// primer gesto lo desbloquea y a partir de ahí suenan explosiones y sirenas.
for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(ev, () => audio.unlock(), { once: true });
}

// Cada tanque o gigante que desaparece del campo es liquidez que se han comido
// o retirado: suena su explosión.
battlefield.onUnitDestroyed(({ kind }) => audio.explosion(kind));

// ---------------------------------------------------------------- datos ----
const feed = new MarketFeed(watchlist.activo);
alarms.setSymbol(watchlist.activo);
hud.setSymbol(watchlist.activo);

// Elegir moneda en el watchlist mueve el campo de batalla entero.
watchlist.onSelect = (symbol) => {
  feed.setSymbol(symbol);
  alarms.setSymbol(symbol);
  hud.setSymbol(symbol);
  // El libro anterior ya no vale: sin este borrón las tropas de la moneda vieja
  // se quedarían plantadas hasta que llegara el primer snapshot de la nueva.
  pendingBook = null;
  battlefield.reset();
};

// Las cotizaciones del watchlist alimentan las alarmas de las monedas que no
// se están mirando: una alarma de ETH suena aunque tengas el campo en BTC.
watchlist.onPrecio = (symbol, precio) => {
  if (symbol !== feed.symbol) alarms.onPrice(symbol, precio);
};

feed.on('status', ({ source, detail }) => hud.setStatus(source, detail));
feed.on('ticker', (t) => hud.setTicker(t));

feed.on('trade', (t) => {
  battlefield.fireTrade(t);
  // El ticker de 24h llega una vez por segundo; los trades dan el precio al instante.
  hud.setPrice(t.price);
  alarms.onPrice(feed.symbol, t.price);
  alarms.onTrade(t);
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

  // Pared = el tramo más cargado de cada lado. Ya viene en dólares del libro,
  // valorado nivel a nivel, así que no hay que multiplicar por el mid.
  let buyWall = 0;
  let sellWall = 0;
  for (let i = 0; i < BINS; i++) {
    if (depth.bidUsd[i] > buyWall) buyWall = depth.bidUsd[i];
    if (depth.askUsd[i] > sellWall) sellWall = depth.askUsd[i];
  }

  hud.setDepth({
    bidVol: depth.bidVol,
    askVol: depth.askVol,
    spread: best.spread,
    binSize,
    levels: BINS,
    buyWall,
    sellWall,
    bidUsdTotal: depth.bidUsdTotal,
    askUsdTotal: depth.askUsdTotal,
    reserveBid: depth.bidOutUsd,
    reserveAsk: depth.askOutUsd,
  });
  alarms.onDepth({ buyWall, sellWall });
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
  alarms.tick();

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
window.__battlefield = { feed, battlefield, hud, audio, alarms, controls };
