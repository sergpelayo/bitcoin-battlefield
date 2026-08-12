/**
 * Reloj y alarmas.
 *
 * Tres familias que comparten aviso (sirena + notificación + cartel):
 *
 *   - de hora    : como un despertador de toda la vida.
 *   - de precio  : suena cuando BTC cruza un nivel, suba o baje.
 *   - de mercado : vigilancias permanentes que se activan con una casilla.
 *
 * Todo vive en localStorage y todo ocurre en el navegador: no hay servidor
 * detrás, así que las alarmas sólo suenan con la pestaña abierta. Es una
 * limitación consciente — vigilar el mercado con la pestaña cerrada exige un
 * proceso 24/7 y deja de ser gratis.
 */

const CLAVE = 'bb.alarmas.v1';

/**
 * Umbrales por defecto. No son redondeos al azar: con BTCUSDT un tramo mediano
 * del libro carga ~$450.000 y el mayor ronda los $2M, así que $2M marca la
 * pared que de verdad destaca. Y $250.000 en un solo trade son ~4 BTC de golpe,
 * muy por encima del tamaño corriente.
 */
export const VIGILANCIAS = [
  {
    id: 'wall',
    nombre: 'Muro de liquidez',
    detalle: 'Alguien planta ≥ $2M en un solo tramo de precio',
    pordefecto: true,
    umbral: 2_000_000,
  },
  {
    id: 'whale',
    nombre: 'Trade ballena',
    detalle: 'Una sola orden se come ≥ $250.000',
    pordefecto: true,
    umbral: 250_000,
  },
  {
    id: 'move',
    nombre: 'Movimiento brusco',
    detalle: 'El precio se mueve ≥ 0,4% en 3 minutos',
    pordefecto: true,
    umbral: 0.4,
  },
  {
    id: 'round',
    nombre: 'Cruce de millar',
    detalle: 'BTC cruza un múltiplo de $1.000',
    pordefecto: false,
    umbral: 1000,
  },
];

// Cada vigilancia calla un rato tras saltar: si no, un muro que oscila alrededor
// del umbral dispararía la sirena en bucle.
const ESPERA_MS = { wall: 120_000, whale: 45_000, move: 180_000, round: 60_000 };
const VENTANA_MOV_MS = 180_000;

const $ = (id) => document.getElementById(id);
const usd0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const dosDig = (n) => String(n).padStart(2, '0');

const fmtUsd = (v) => `$${usd0.format(Math.round(v))}`;

export class Alarms {
  constructor(audio) {
    this.audio = audio;
    this.lista = [];
    this.vigilancia = {};
    this.precio = null;
    this._ultimoAviso = {};
    this._historia = []; // [{t, precio}] para el movimiento brusco
    this._ultimoMillar = null;
    this._relojPrev = '';

    this._cargar();
    this._montar();
    this._pintarLista();
  }

  // ------------------------------------------------------------ persistencia ----
  _cargar() {
    let guardado = null;
    try {
      guardado = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    } catch {
      guardado = null; // storage corrupto: arrancamos limpios en vez de reventar
    }
    for (const v of VIGILANCIAS) {
      this.vigilancia[v.id] = guardado?.vigilancia?.[v.id] ?? v.pordefecto;
    }
    this.lista = Array.isArray(guardado?.lista) ? guardado.lista : [];
    // Una alarma de hora que venció con la pestaña cerrada no debe sonar al abrir.
    const ahora = Date.now();
    this.lista = this.lista.filter((a) => a.kind !== 'time' || a.cuando > ahora);
  }

  _guardar() {
    try {
      localStorage.setItem(
        CLAVE,
        JSON.stringify({ vigilancia: this.vigilancia, lista: this.lista }),
      );
    } catch {
      /* modo privado o cuota llena: no es motivo para romper la app */
    }
  }

  // ------------------------------------------------------------------ montaje ----
  _montar() {
    this.el = {
      hora: $('clock-time'),
      fecha: $('clock-date'),
      siguiente: $('clock-next'),
      lista: $('alarm-list'),
      cuenta: $('alarm-count'),
      vigilancias: $('market-alarms'),
      pistaPrecio: $('price-hint'),
      toast: $('alarm-toast'),
      toastK: $('toast-k'),
      toastV: $('toast-v'),
    };

    // --- vigilancias de mercado ---
    for (const v of VIGILANCIAS) {
      const li = document.createElement('li');
      const lab = document.createElement('label');
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = this.vigilancia[v.id];
      chk.addEventListener('change', () => {
        this.vigilancia[v.id] = chk.checked;
        this._guardar();
      });
      lab.append(chk, ` ${v.nombre}`);
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = v.detalle;
      li.append(lab, hint);
      this.el.vigilancias.append(li);
    }

    // --- alta de alarma de precio ---
    $('form-price').addEventListener('submit', (e) => {
      e.preventDefault();
      const precio = parseFloat($('in-price').value);
      if (!Number.isFinite(precio) || precio <= 0) return;
      // La dirección se fija al crearla: si ahora estamos por debajo, la alarma
      // es "cuando suba hasta aquí". Sin esto, crear una alarma en el precio
      // actual saltaría al instante con cualquier oscilación.
      const desde = this.precio ?? precio;
      this._alta({
        id: crypto.randomUUID(),
        kind: 'price',
        valor: precio,
        arriba: precio > desde,
        etiqueta: $('in-price-label').value.trim(),
      });
      $('in-price').value = '';
      $('in-price-label').value = '';
    });

    // --- alta de alarma de hora ---
    $('form-time').addEventListener('submit', (e) => {
      e.preventDefault();
      const hhmm = $('in-time').value;
      if (!hhmm) return;
      const [h, m] = hhmm.split(':').map(Number);
      const cuando = new Date();
      cuando.setHours(h, m, 0, 0);
      // Si esa hora ya pasó hoy, se entiende que es la de mañana.
      if (cuando.getTime() <= Date.now()) cuando.setDate(cuando.getDate() + 1);
      this._alta({
        id: crypto.randomUUID(),
        kind: 'time',
        cuando: cuando.getTime(),
        etiqueta: $('in-time-label').value.trim(),
      });
      $('in-time').value = '';
      $('in-time-label').value = '';
    });

    $('toast-ok').addEventListener('click', () => this._ocultarToast());
  }

  _alta(alarma) {
    this.lista.push(alarma);
    this._guardar();
    this._pintarLista();
    this._pedirPermiso();
  }

  _borrar(id) {
    this.lista = this.lista.filter((a) => a.id !== id);
    this._guardar();
    this._pintarLista();
  }

  _pedirPermiso() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission();
  }

  // ------------------------------------------------------------------ pintado ----
  _pintarLista() {
    const l = this.el.lista;
    l.textContent = '';
    const ordenada = [...this.lista].sort((a, b) => this._orden(a) - this._orden(b));

    for (const a of ordenada) {
      const li = document.createElement('li');
      li.className = `alarm alarm--${a.kind}`;

      const txt = document.createElement('span');
      txt.className = 'alarm-k';
      txt.textContent =
        a.kind === 'time' ? this._horaDe(a.cuando) : `${a.arriba ? '▲' : '▼'} ${fmtUsd(a.valor)}`;

      const et = document.createElement('span');
      et.className = 'alarm-v';
      et.textContent = a.etiqueta || (a.kind === 'time' ? 'despertador' : 'nivel de precio');

      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'btn btn--x';
      x.textContent = '✕';
      x.addEventListener('click', () => this._borrar(a.id));

      li.append(txt, et, x);
      l.append(li);
    }

    this.el.cuenta.textContent = this.lista.length ? `(${this.lista.length})` : '';
    if (!this.lista.length) {
      const li = document.createElement('li');
      li.className = 'dim';
      li.textContent = 'ninguna';
      l.append(li);
    }
  }

  _orden(a) {
    return a.kind === 'time' ? a.cuando : Number.MAX_SAFE_INTEGER;
  }

  _horaDe(ms) {
    const d = new Date(ms);
    return `${dosDig(d.getHours())}:${dosDig(d.getMinutes())}`;
  }

  // -------------------------------------------------------------------- reloj ----
  /** Se llama en cada frame; sólo toca el DOM cuando cambia el segundo. */
  tick() {
    const d = new Date();
    const hora = `${dosDig(d.getHours())}:${dosDig(d.getMinutes())}:${dosDig(d.getSeconds())}`;
    if (hora !== this._relojPrev) {
      this._relojPrev = hora;
      this.el.hora.textContent = hora;
      this.el.fecha.textContent = d.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      this._pintarSiguiente();
      this._revisarHoras();
    }
  }

  _pintarSiguiente() {
    const proximas = this.lista.filter((a) => a.kind === 'time').sort((a, b) => a.cuando - b.cuando);
    const precios = this.lista.filter((a) => a.kind === 'price').length;

    if (!proximas.length) {
      this.el.siguiente.textContent = precios
        ? `${precios} alarma${precios > 1 ? 's' : ''} de precio`
        : 'sin alarmas';
      return;
    }
    const falta = proximas[0].cuando - Date.now();
    const h = Math.floor(falta / 3_600_000);
    const m = Math.floor((falta % 3_600_000) / 60_000);
    const s = Math.floor((falta % 60_000) / 1000);
    const cuenta = h > 0 ? `${h}h ${dosDig(m)}m` : `${dosDig(m)}:${dosDig(s)}`;
    this.el.siguiente.textContent = `⏰ ${cuenta}${precios ? ` · ${precios} de precio` : ''}`;
  }

  _revisarHoras() {
    const ahora = Date.now();
    for (const a of this.lista.filter((x) => x.kind === 'time' && x.cuando <= ahora)) {
      this._sonar('DESPERTADOR', a.etiqueta || this._horaDe(a.cuando));
      this._borrar(a.id);
    }
  }

  // ------------------------------------------------------------------- precio ----
  onPrice(precio) {
    if (!Number.isFinite(precio)) return;
    const anterior = this.precio;
    this.precio = precio;
    this.el.pistaPrecio.textContent = `Suena al cruzar ese precio. Ahora: ${fmtUsd(precio)}.`;
    if (anterior == null) {
      this._ultimoMillar = Math.floor(precio / 1000);
      return;
    }

    // --- alarmas de precio del usuario ---
    for (const a of this.lista.filter((x) => x.kind === 'price')) {
      const cruzado = a.arriba ? anterior < a.valor && precio >= a.valor : anterior > a.valor && precio <= a.valor;
      if (!cruzado) continue;
      this._sonar('PRECIO', `${a.etiqueta ? `${a.etiqueta} — ` : ''}BTC ${fmtUsd(precio)}`);
      this._borrar(a.id);
    }

    // --- cruce de millar ---
    const millar = Math.floor(precio / 1000);
    if (this._ultimoMillar != null && millar !== this._ultimoMillar) {
      const subiendo = millar > this._ultimoMillar;
      this._vigilar('round', 'CRUCE DE MILLAR', `BTC ${subiendo ? 'supera' : 'pierde'} ${fmtUsd(millar * 1000 + (subiendo ? 0 : 1000))}`);
      this._ultimoMillar = millar;
    }

    // --- movimiento brusco ---
    const ahora = Date.now();
    this._historia.push({ t: ahora, precio });
    while (this._historia.length && ahora - this._historia[0].t > VENTANA_MOV_MS) this._historia.shift();
    const viejo = this._historia[0];
    if (viejo && ahora - viejo.t > VENTANA_MOV_MS * 0.8) {
      const pct = ((precio - viejo.precio) / viejo.precio) * 100;
      const umbral = VIGILANCIAS.find((v) => v.id === 'move').umbral;
      if (Math.abs(pct) >= umbral) {
        this._vigilar(
          'move',
          'MOVIMIENTO BRUSCO',
          `${pct > 0 ? '▲' : '▼'} ${pct.toFixed(2)}% en 3 min · ${fmtUsd(precio)}`,
        );
      }
    }
  }

  onTrade({ price, qty }) {
    const usd = price * qty;
    const umbral = VIGILANCIAS.find((v) => v.id === 'whale').umbral;
    if (usd >= umbral) {
      this._vigilar('whale', 'TRADE BALLENA', `${qty.toFixed(3)} BTC · ${fmtUsd(usd)}`);
    }
  }

  onDepth({ buyWall, sellWall }) {
    const umbral = VIGILANCIAS.find((v) => v.id === 'wall').umbral;
    if (buyWall >= umbral) this._vigilar('wall', 'MURO DE COMPRA', `${fmtUsd(buyWall)} defendiendo abajo`);
    if (sellWall >= umbral) this._vigilar('wall', 'MURO DE VENTA', `${fmtUsd(sellWall)} tapando arriba`);
  }

  // -------------------------------------------------------------------- aviso ----
  _vigilar(id, titulo, detalle) {
    if (!this.vigilancia[id]) return;
    const ahora = Date.now();
    if (ahora - (this._ultimoAviso[id] || 0) < ESPERA_MS[id]) return;
    this._ultimoAviso[id] = ahora;
    this._sonar(titulo, detalle);
  }

  _sonar(titulo, detalle) {
    this.audio.alarm();
    this.el.toastK.textContent = titulo;
    this.el.toastV.textContent = detalle;
    this.el.toast.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this._ocultarToast(), 12_000);

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`⚔️ ${titulo}`, { body: detalle, tag: 'bitcoin-battlefield' });
      } catch {
        /* algunos navegadores lo prohíben fuera de un service worker */
      }
    }
  }

  _ocultarToast() {
    this.el.toast.hidden = true;
  }
}
