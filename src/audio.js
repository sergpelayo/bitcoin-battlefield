/**
 * Sonido de la aplicación.
 *
 * Las explosiones y la sirena están **sintetizadas** con WebAudio en lugar de
 * ser ficheros: pesan cero, no hay descarga que esperar y una explosión puede
 * sonar distinta cada vez (misma receta, parámetros aleatorios) sin que se note
 * el bucle. Los ficheros quedan sólo para la música de fondo, que sí es autoral.
 *
 * El navegador prohíbe crear audio antes de que el usuario toque la página, así
 * que el AudioContext no existe hasta el primer clic o tecla. Todo lo que se
 * llame antes de eso se ignora sin romper nada.
 */

const MUSIC_VOL = 0.35;

export class Audio {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = false;
    this.music = null;
    this._masterSfx = null;
    // Dos explosiones en el mismo frame se suman y saturan; limitamos el ritmo.
    this._lastBlast = 0;
  }

  /** Se llama desde el primer gesto del usuario: sin gesto no hay audio. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this._masterSfx = this.ctx.createGain();
    this._masterSfx.gain.value = 0.9;
    this._masterSfx.connect(this.ctx.destination);
  }

  setSfx(on) {
    this.sfxOn = on;
  }

  // ------------------------------------------------------------ explosiones ----
  /**
   * Estallido: ruido blanco filtrado con la envolvente cayendo rápido, más un
   * golpe grave de seno que da el "pum" en el pecho. Un gigante suena más grave
   * y dura casi el triple que un tanque, que es lo que separa perder $100.000
   * de perder un millón.
   */
  explosion(kind = 'tank') {
    if (!this.sfxOn || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this._lastBlast < 0.05) return;
    this._lastBlast = now;

    const grande = kind === 'giant';
    const dur = grande ? 1.5 : 0.55;
    const vol = grande ? 0.75 : 0.32;

    // --- cuerpo: ruido filtrado ---
    const frames = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // Decaimiento exponencial: la cola se apaga sola sin corte brusco.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, grande ? 2 : 3);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(grande ? 900 : 1800, now);
    lp.frequency.exponentialRampToValueAtTime(grande ? 90 : 240, now + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(lp).connect(g).connect(this._masterSfx);
    src.start(now);
    src.stop(now + dur);

    // --- golpe grave ---
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(grande ? 110 : 170, now);
    osc.frequency.exponentialRampToValueAtTime(grande ? 26 : 48, now + dur * 0.7);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(vol * 0.9, now);
    og.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.8);
    osc.connect(og).connect(this._masterSfx);
    osc.start(now);
    osc.stop(now + dur);
  }

  // ---------------------------------------------------------------- alarma ----
  /**
   * Sirena antiaérea: dos tonos que suben y bajan. Es deliberadamente distinta
   * de las explosiones —que suenan solas todo el rato— para que una alarma no
   * se confunda con el ruido de fondo de la batalla.
   */
  alarm(ciclos = 3) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.ctx.destination);

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';

    const filtro = this.ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 1400;

    osc.connect(filtro).connect(g);
    osc2.connect(g);

    const ciclo = 1.4;
    for (let i = 0; i < ciclos; i++) {
      const t0 = now + i * ciclo;
      osc.frequency.setValueAtTime(380, t0);
      osc.frequency.linearRampToValueAtTime(680, t0 + ciclo * 0.45);
      osc.frequency.linearRampToValueAtTime(380, t0 + ciclo * 0.95);
      osc2.frequency.setValueAtTime(190, t0);
      osc2.frequency.linearRampToValueAtTime(340, t0 + ciclo * 0.45);
      osc2.frequency.linearRampToValueAtTime(190, t0 + ciclo * 0.95);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.22, t0 + 0.12);
      g.gain.setValueAtTime(0.22, t0 + ciclo * 0.8);
      g.gain.linearRampToValueAtTime(0.0001, t0 + ciclo * 0.98);
    }
    const fin = now + ciclos * ciclo;
    osc.start(now);
    osc2.start(now);
    osc.stop(fin);
    osc2.stop(fin);
  }

  // ---------------------------------------------------------------- música ----
  /**
   * Música de fondo desde un fichero servido en `public/`. Si no existe (que es
   * el caso mientras no se suba ninguna pista), falla en silencio y la casilla
   * se queda desactivada: nunca debe reventar la escena por no haber un mp3.
   */
  setMusicTrack(url) {
    if (!this.music) {
      this.music = new window.Audio();
      this.music.loop = true;
      this.music.volume = MUSIC_VOL;
      this.music.addEventListener('error', () => {
        this.musicOn = false;
        this.onMusicError?.();
      });
    }
    this.music.src = url;
  }

  setMusic(on) {
    this.musicOn = on;
    if (!this.music) return;
    if (on) this.music.play().catch(() => this.onMusicError?.());
    else this.music.pause();
  }

  setMusicVolume(v) {
    if (this.music) this.music.volume = v;
  }
}
