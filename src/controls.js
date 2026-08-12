/**
 * Cajón de control: pestañas, audio y reproductor de YouTube.
 *
 * Sobre YouTube Music: `music.youtube.com` responde con la cabecera
 * `x-frame-options: SAMEORIGIN`, así que el navegador se niega a cargarlo en un
 * iframe y no hay forma de esquivarlo desde la web. Lo que sí funciona es sacar
 * el ID de la lista de esa URL y reproducirla con el iframe de `youtube.com`,
 * que es el mismo catálogo. Por eso pegar un enlace de YouTube Music aquí
 * funciona aunque el sitio no se pueda incrustar.
 */

const CLAVE = 'bb.controles.v1';
const $ = (id) => document.getElementById(id);

/** Saca el ID de vídeo o de lista de cualquier forma de enlace de YouTube. */
export function parseYouTube(url) {
  const limpio = (url || '').trim();
  if (!limpio) return null;

  // Un ID de lista pelado o una URL con ?list=: la lista manda sobre el vídeo,
  // porque quien pega una playlist quiere la playlist entera, no su primer tema.
  if (/^PL[\w-]{10,}$|^OLAK5uy_[\w-]+$|^RD[\w-]+$/.test(limpio)) {
    return { tipo: 'lista', id: limpio };
  }
  let u;
  try {
    u = new URL(limpio.startsWith('http') ? limpio : `https://${limpio}`);
  } catch {
    return /^[\w-]{11}$/.test(limpio) ? { tipo: 'video', id: limpio } : null;
  }
  const lista = u.searchParams.get('list');
  if (lista) return { tipo: 'lista', id: lista };

  const v = u.searchParams.get('v');
  if (v) return { tipo: 'video', id: v };
  if (u.hostname.endsWith('youtu.be')) {
    const id = u.pathname.slice(1);
    if (id) return { tipo: 'video', id };
  }
  const emb = u.pathname.match(/\/embed\/([\w-]{11})/);
  if (emb) return { tipo: 'video', id: emb[1] };
  return null;
}

export function embedUrl({ tipo, id }) {
  return tipo === 'lista'
    ? `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(id)}&autoplay=1`
    : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1`;
}

export class Controls {
  constructor(audio) {
    this.audio = audio;
    this.estado = { musica: '', yt: '', volumen: 35, sfx: true };
    this._cargar();
    this._montar();
  }

  _cargar() {
    try {
      Object.assign(this.estado, JSON.parse(localStorage.getItem(CLAVE) || '{}'));
    } catch {
      /* storage corrupto: seguimos con los valores por defecto */
    }
  }

  _guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(this.estado));
    } catch {
      /* sin storage se pierde la preferencia, nada más */
    }
  }

  _montar() {
    const cajon = $('drawer');
    const abrir = (pestana) => {
      cajon.hidden = false;
      const alarmas = pestana === 'alarms';
      $('tab-alarms').hidden = !alarmas;
      $('tab-audio').hidden = alarmas;
      $('drawer-title').textContent = alarmas ? 'ALARMAS' : 'AUDIO';
    };
    $('open-alarms').addEventListener('click', () => abrir('alarms'));
    $('open-audio').addEventListener('click', () => abrir('audio'));
    $('drawer-close').addEventListener('click', () => {
      cajon.hidden = true;
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cajon.hidden = true;
    });

    // --- efectos ---
    const sfx = $('chk-sfx');
    sfx.checked = this.estado.sfx;
    this.audio.setSfx(this.estado.sfx);
    sfx.addEventListener('change', () => {
      this.estado.sfx = sfx.checked;
      this.audio.setSfx(sfx.checked);
      this._guardar();
    });

    // --- música propia ---
    const chkMus = $('chk-music');
    const pista = $('in-music');
    const aviso = $('music-hint');
    pista.value = this.estado.musica;
    if (this.estado.musica) this.audio.setMusicTrack(this.estado.musica);

    this.audio.onMusicError = () => {
      chkMus.checked = false;
      aviso.textContent = 'No se pudo cargar esa pista. Revisa la ruta dentro de public/.';
      aviso.classList.add('warn');
    };

    const cargarPista = () => {
      const ruta = pista.value.trim();
      if (!ruta) return;
      this.estado.musica = ruta;
      this._guardar();
      aviso.classList.remove('warn');
      aviso.textContent = `Pista: ${ruta}`;
      this.audio.setMusicTrack(ruta);
      chkMus.checked = true;
      this.audio.setMusic(true);
    };
    $('btn-music').addEventListener('click', cargarPista);
    chkMus.addEventListener('change', () => {
      if (chkMus.checked && !this.estado.musica) {
        chkMus.checked = false;
        aviso.textContent = 'Primero indica la ruta de tu fichero y pulsa CARGAR.';
        return;
      }
      this.audio.setMusic(chkMus.checked);
    });

    const vol = $('in-vol');
    vol.value = this.estado.volumen;
    this.audio.setMusicVolume(this.estado.volumen / 100);
    vol.addEventListener('input', () => {
      this.estado.volumen = Number(vol.value);
      this.audio.setMusicVolume(this.estado.volumen / 100);
      this._guardar();
    });

    // --- YouTube ---
    const entrada = $('in-yt');
    entrada.value = this.estado.yt;
    $('btn-yt').addEventListener('click', () => this._cargarYt(entrada.value));
    entrada.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._cargarYt(entrada.value);
    });
  }

  _cargarYt(url) {
    const holder = $('yt-holder');
    const ref = parseYouTube(url);
    if (!ref) {
      holder.textContent = 'No reconozco ese enlace. Pega la URL de un vídeo o de una playlist.';
      holder.className = 'yt-holder warn';
      return;
    }
    this.estado.yt = url.trim();
    this._guardar();

    holder.className = 'yt-holder';
    holder.textContent = '';
    const iframe = document.createElement('iframe');
    iframe.src = embedUrl(ref);
    iframe.width = '100%';
    iframe.height = '160';
    iframe.loading = 'lazy';
    iframe.allow = 'autoplay; encrypted-media';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allowfullscreen', '');
    holder.append(iframe);
  }
}
