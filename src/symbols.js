/**
 * Catálogo de pares contra USDT.
 *
 * Sale de `/api/v3/ticker/price`: 153 KB para 733 pares **con su precio**. El
 * endpoint "correcto" para listar mercados sería `/exchangeInfo`, pero pesa
 * 17 MB — inaceptable de descargar en el navegador sólo para llenar un
 * buscador, y encima no trae precios.
 *
 * Se cachea un día en localStorage: la lista de pares no cambia de un rato a
 * otro y así el buscador abre instantáneo en visitas siguientes.
 */

const CLAVE = 'bb.catalogo.v1';
const VIDA_MS = 24 * 60 * 60 * 1000;
const REST = 'https://data-api.binance.vision';

/** Lo que se ofrece de entrada, por volumen y por ser lo que la gente busca. */
export const DESTACADAS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'MATICUSDT',
];

export const PAR_POR_DEFECTO = 'BTCUSDT';

/**
 * Los precios cruzan cinco órdenes de magnitud entre pares: BTC no necesita
 * decimales y PEPE necesita ocho. Un formato fijo dejaría PEPE en "0,00".
 */
export function fmtPrecio(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return v.toLocaleString('es-ES', { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(4);
  if (v >= 0.0001) return v.toFixed(6);
  return v.toFixed(8);
}

/** Nombre corto para pintar: BTCUSDT -> BTC. */
export function baseDe(symbol) {
  return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
}

let cache = null;

export async function cargarCatalogo() {
  if (cache) return cache;

  try {
    const g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    if (g && Date.now() - g.t < VIDA_MS && Array.isArray(g.pares)) {
      cache = g.pares;
      return cache;
    }
  } catch {
    /* cache corrupta: se vuelve a pedir */
  }

  const res = await fetch(`${REST}/api/v3/ticker/price`);
  if (!res.ok) throw new Error(`catálogo: HTTP ${res.status}`);
  const todos = await res.json();

  const pares = todos
    .filter((x) => x.symbol.endsWith('USDT') && Number(x.price) > 0)
    // Los apalancados (BTCUP, BTCDOWN) y los pares con stablecoins de la propia
    // Binance no tienen un libro que dé buen campo de batalla: fuera del buscador.
    .filter((x) => !/(UP|DOWN|BEAR|BULL)USDT$/.test(x.symbol))
    .filter((x) => !/^(USDC|FDUSD|TUSD|BUSD|EUR|GBP|TRY|BRL|ARS)USDT$/.test(x.symbol))
    .map((x) => ({ symbol: x.symbol, base: baseDe(x.symbol), precio: Number(x.price) }))
    .sort((a, b) => a.base.localeCompare(b.base));

  cache = pares;
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ t: Date.now(), pares }));
  } catch {
    /* sin cache funciona igual, sólo tarda más la próxima vez */
  }
  return pares;
}

/** Filtro del buscador: primero los que empiezan por el texto. */
export function buscar(pares, texto, limite = 40) {
  const q = texto.trim().toUpperCase();
  if (!q) return pares.slice(0, limite);
  const empieza = [];
  const contiene = [];
  for (const p of pares) {
    if (p.base.startsWith(q)) empieza.push(p);
    else if (p.base.includes(q)) contiene.push(p);
    if (empieza.length >= limite) break;
  }
  return [...empieza, ...contiene].slice(0, limite);
}
