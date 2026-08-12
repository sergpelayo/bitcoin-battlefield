/**
 * Watchlist de monedas con precio en vivo.
 *
 * Los precios NO salen del feed principal: ese está ocupado con el libro
 * completo del par que se está mirando. Aquí se abre un segundo WebSocket
 * combinado de `@miniTicker`, que manda un mensaje por segundo y por moneda con
 * cierre y apertura de 24 h. Es lo más barato que hay para tener varias
 * cotizaciones a la vez, y se reabre solo cuando la lista cambia.
 */

import { DESTACADAS, PAR_POR_DEFECTO, baseDe, buscar, cargarCatalogo, fmtPrecio } from './symbols.js';

const CLAVE = 'bb.watchlist.v1';
const WS = 'wss://data-stream.binance.vision:9443';
const $ = (id) => document.getElementById(id);

export class Watchlist {
  constructor(license) {
    this.license = license;
    this.symbols = [];
    this.activo = PAR_POR_DEFECTO;
    this.precios = new Map();
    this.catalogo = [];
    this._ws = null;
    /** Lo pone main.js: cambia el campo de batalla al par elegido. */
    this.onSelect = null;
    /** Cada cotización que entra, para que las alarmas de otras monedas suenen. */
    this.onPrecio = null;

    this._cargar();
    this._montar();
    this._pintar();
    this._conectar();

    cargarCatalogo()
      .then((c) => {
        this.catalogo = c;
        this._pintarResultados('');
      })
      .catch(() => {
        // Sin catálogo el buscador queda cojo, pero el watchlist sigue vivo con
        // lo que ya tiene: no es motivo para dejar la app inservible.
        this.catalogo = DESTACADAS.map((s) => ({ symbol: s, base: baseDe(s), precio: 0 }));
        this._pintarResultados('');
      });
  }

  // --------------------------------------------------------------- estado ----
  _cargar() {
    let g = null;
    try {
      g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    } catch {
      g = null;
    }
    this.symbols = Array.isArray(g?.symbols) && g.symbols.length ? g.symbols : ['BTCUSDT', 'ETHUSDT'];
    this.activo = g?.activo || this.symbols[0] || PAR_POR_DEFECTO;
    // Si el plan bajó de pro a gratuito, la lista guardada puede exceder el
    // límite: se recorta al abrir en vez de dejar un estado imposible.
    this._recortarAlPlan();
  }

  _recortarAlPlan() {
    const max = this.license.plan.monedas;
    if (this.symbols.length > max) this.symbols = this.symbols.slice(0, max);
    if (!this.symbols.includes(this.activo)) this.activo = this.symbols[0] || PAR_POR_DEFECTO;
  }

  _guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({ symbols: this.symbols, activo: this.activo }));
    } catch {
      /* sin storage la lista dura lo que la pestaña */
    }
  }

  // -------------------------------------------------------------- montaje ----
  _montar() {
    this.el = {
      lista: $('watch-list'),
      buscador: $('in-symbol'),
      resultados: $('symbol-results'),
      aviso: $('watch-hint'),
    };

    this.el.buscador.addEventListener('input', () => this._pintarResultados(this.el.buscador.value));
    this.el.buscador.addEventListener('focus', () => this._pintarResultados(this.el.buscador.value));
  }

  /** Se vuelve a llamar al activar el plan de pago, para soltar los límites. */
  refrescarPlan() {
    this._recortarAlPlan();
    this._pintar();
    this._pintarResultados(this.el.buscador.value);
    this._conectar();
  }

  // -------------------------------------------------------------- pintado ----
  _pintar() {
    const l = this.el.lista;
    l.textContent = '';

    for (const s of this.symbols) {
      const li = document.createElement('li');
      li.className = `watch-row${s === this.activo ? ' is-active' : ''}`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'watch-pick';
      btn.title = `Llevar el campo de batalla a ${baseDe(s)}`;

      const base = document.createElement('span');
      base.className = 'watch-base';
      base.textContent = baseDe(s);

      const precio = document.createElement('span');
      precio.className = 'watch-price';
      precio.id = `wp-${s}`;
      const p = this.precios.get(s);
      precio.textContent = p ? fmtPrecio(p.precio) : '—';

      const chg = document.createElement('span');
      chg.className = 'watch-chg';
      chg.id = `wc-${s}`;
      if (p) {
        chg.textContent = `${p.pct >= 0 ? '+' : ''}${p.pct.toFixed(2)}%`;
        chg.classList.add(p.pct >= 0 ? 'up' : 'down');
      }

      btn.append(base, precio, chg);
      btn.addEventListener('click', () => this.seleccionar(s));
      li.append(btn);

      // La última moneda no se puede quitar: sin par activo no hay nada que pintar.
      if (this.symbols.length > 1) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'btn btn--x';
        x.textContent = '✕';
        x.title = 'Quitar del watchlist';
        x.addEventListener('click', () => this.quitar(s));
        li.append(x);
      }
      l.append(li);
    }

    const max = this.license.plan.monedas;
    this.el.aviso.textContent = this.license.esPro
      ? `${this.symbols.length} monedas · plan ${this.license.plan.nombre}`
      : `${this.symbols.length} de ${max} monedas · plan ${this.license.plan.nombre}`;

    // El buscador libre es de pago; en gratuito se ofrece una lista corta.
    this.el.buscador.disabled = !this.license.esPro;
    this.el.buscador.placeholder = this.license.esPro
      ? 'buscar entre 600+ pares…'
      : 'buscador — plan COMANDANTE';
  }

  _pintarResultados(texto) {
    const r = this.el.resultados;
    r.textContent = '';

    // En gratuito no hay filtrado: se ofrece la lista corta de siempre.
    const fuente = this.license.esPro
      ? this.catalogo
      : this.catalogo.filter((c) => DESTACADAS.includes(c.symbol));
    const encontrados = buscar(fuente, this.license.esPro ? texto : '', this.license.esPro ? 40 : 10);

    const hueco = this.license.cabeOtraMoneda(this.symbols.length);

    for (const c of encontrados) {
      if (this.symbols.includes(c.symbol)) continue;
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sym';
      b.textContent = c.base;
      b.disabled = !hueco;
      b.title = hueco ? `Añadir ${c.base}` : 'Límite de monedas alcanzado';
      b.addEventListener('click', () => this.anadir(c.symbol));
      li.append(b);
      r.append(li);
    }

    if (!hueco) {
      const li = document.createElement('li');
      li.className = 'hint warn';
      li.textContent = `El plan ${this.license.plan.nombre} permite ${this.license.plan.monedas} monedas.`;
      r.append(li);
    }
  }

  /** Actualiza sólo los dos textos que cambian, sin repintar la lista entera. */
  _refrescarPrecio(symbol) {
    const p = this.precios.get(symbol);
    if (!p) return;
    const ep = document.getElementById(`wp-${symbol}`);
    const ec = document.getElementById(`wc-${symbol}`);
    if (ep) ep.textContent = fmtPrecio(p.precio);
    if (ec) {
      ec.textContent = `${p.pct >= 0 ? '+' : ''}${p.pct.toFixed(2)}%`;
      ec.classList.toggle('up', p.pct >= 0);
      ec.classList.toggle('down', p.pct < 0);
    }
  }

  // --------------------------------------------------------------- acciones ----
  anadir(symbol) {
    if (this.symbols.includes(symbol)) return false;
    if (!this.license.cabeOtraMoneda(this.symbols.length)) return false;
    this.symbols.push(symbol);
    this._guardar();
    this._pintar();
    this._pintarResultados(this.el.buscador.value);
    this._conectar();
    return true;
  }

  quitar(symbol) {
    if (this.symbols.length <= 1) return;
    this.symbols = this.symbols.filter((s) => s !== symbol);
    if (this.activo === symbol) this.seleccionar(this.symbols[0]);
    this._guardar();
    this._pintar();
    this._pintarResultados(this.el.buscador.value);
    this._conectar();
  }

  seleccionar(symbol) {
    if (!symbol) return;
    this.activo = symbol;
    this._guardar();
    this._pintar();
    this.onSelect?.(symbol);
  }

  // ------------------------------------------------------------- cotizaciones ----
  _conectar() {
    if (this._ws) {
      this._ws.onclose = null;
      try {
        this._ws.close();
      } catch {
        /* ya estaba cerrado */
      }
      this._ws = null;
    }
    if (!this.symbols.length) return;

    const streams = this.symbols.map((s) => `${s.toLowerCase()}@miniTicker`).join('/');
    let ws;
    try {
      ws = new WebSocket(`${WS}/stream?streams=${streams}`);
    } catch {
      return; // sin cotizaciones el watchlist sigue navegable
    }
    this._ws = ws;

    ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      const d = msg.data;
      if (!d || d.e !== '24hrMiniTicker') return;
      const cierre = parseFloat(d.c);
      const apertura = parseFloat(d.o);
      this.precios.set(d.s, {
        precio: cierre,
        pct: apertura > 0 ? ((cierre - apertura) / apertura) * 100 : 0,
      });
      this._refrescarPrecio(d.s);
      this.onPrecio?.(d.s, cierre);
    };
    ws.onclose = () => {
      // Reconexión perezosa: no es dato crítico, no merece un reintento agresivo.
      if (this._ws === ws) setTimeout(() => this._conectar(), 8000);
    };
  }
}
