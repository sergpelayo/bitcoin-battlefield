import { JSDOM } from 'jsdom';
import fs from 'node:fs';

// Prueba de humo sobre un DOM real (jsdom). No cubre la escena 3D —eso necesita
// WebGL— sino el cableado del HUD y, sobre todo, los límites de los planes:
// es la lógica que más silenciosamente se puede romper al tocar otra cosa.

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:5173/', pretendToBeVisual: true });
const { window } = dom;

// Stubs: el WebSocket de cotizaciones y las notificaciones no se prueban aquí.
class FakeWS { constructor(){ this.readyState=0; } close(){} }
for (const k of ['document','localStorage','HTMLElement','Node','Event','CustomEvent','getComputedStyle','requestAnimationFrame'])
  Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
globalThis.window = window;
globalThis.WebSocket = FakeWS;
window.WebSocket = FakeWS;
globalThis.Notification = undefined;
window.Audio = class { constructor(){ this.volume=1; } play(){ return Promise.resolve(); } pause(){} addEventListener(){} };

const fallos = [];
window.addEventListener('error', (e) => fallos.push('window error: ' + e.message));

const { License, PLANES } = await import('../src/license.js');
const { Watchlist } = await import('../src/watchlist.js');
const { Alarms } = await import('../src/alarms.js');
const { Controls } = await import('../src/controls.js');
const { Hud } = await import('../src/hud.js');
const { Audio } = await import('../src/audio.js');

const ok = (etiqueta, cond, extra='') => console.log(`${cond ? '  OK  ' : ' FALLA'} ${etiqueta}${extra?' · '+extra:''}`);

console.log('\n== construcción ==');
const audio = new Audio();
const license = new License();
const watch = new Watchlist(license);
const alarms = new Alarms(audio, license);
const controls = new Controls(audio, license, watch);
const hud = new Hud();
ok('los seis módulos construyen sin lanzar', true);

console.log('\n== límites del plan gratuito ==');
ok('arranca con 2 monedas', watch.symbols.length === 2, watch.symbols.join(','));
ok('rechaza la 3ª moneda', watch.anadir('SOLUSDT') === false);
ok('sigue con 2', watch.symbols.length === 2);

alarms.setSymbol('BTCUSDT');
const alta = (v) => { window.document.getElementById('in-price').value = String(v);
  window.document.getElementById('form-price').dispatchEvent(new window.Event('submit', {bubbles:true, cancelable:true})); };
alarms.onPrice('BTCUSDT', 60000);
alta(65000);
ok('acepta 1 alarma de precio', alarms.lista.filter(a=>a.kind==='price').length === 1);
alta(70000);
ok('rechaza la 2ª alarma en la misma moneda', alarms.lista.filter(a=>a.kind==='price').length === 1);
ok('el aviso explica el límite', window.document.getElementById('price-hint').textContent.includes('RECLUTA'));

console.log('\n== alarma de precio dispara al cruzar ==');
let sono = 0; const orig = alarms._sonar.bind(alarms); alarms._sonar = (t,d)=>{sono++; orig(t,d);};
alarms.onPrice('BTCUSDT', 64000);
ok('no suena por debajo del nivel', sono === 0);
alarms.onPrice('BTCUSDT', 65500);
ok('suena al cruzar 65000', sono === 1);
ok('la alarma se consume', alarms.lista.filter(a=>a.kind==='price').length === 0);

console.log('\n== alarma de otra moneda, sin mirarla ==');
alarms.setSymbol('BTCUSDT');
alarms.onPrice('ETHUSDT', 1800);
alarms.lista.push({id:'x', kind:'price', symbol:'ETHUSDT', valor:1900, arriba:true, etiqueta:''});
sono = 0;
alarms.onPrice('ETHUSDT', 1950);
ok('suena una alarma de ETH mirando BTC', sono === 1);

console.log('\n== activación del plan de pago ==');
ok('clave inválida rechazada', (await license.activar('cualquiera')) === false);
ok('clave con formato válido acepta', (await license.activar('BB-A1B2-C3D4-E5F6')) === true);
ok('pasa a COMANDANTE', license.esPro && license.plan.monedas === Infinity);
watch.refrescarPlan();
ok('ahora sí admite la 3ª moneda', watch.anadir('SOLUSDT') === true, watch.symbols.join(','));

console.log('\n== cambio de moneda ==');
hud.setSymbol('SOLUSDT');
ok('el rótulo cambia', window.document.getElementById('price-pair').textContent === 'SOL / USDT');
ok('el título cambia', window.document.title.includes('SOLUSDT'));

console.log('\n== reloj ==');
alarms.tick();
ok('pinta la hora', /^\d\d:\d\d:\d\d$/.test(window.document.getElementById('clock-time').textContent));

console.log('\n== YouTube ==');
controls._cargarYt('https://music.youtube.com/playlist?list=OLAK5uy_test123456');
const f = window.document.querySelector('#yt-holder iframe');
ok('inserta el iframe desde una URL de YouTube Music', !!f, f?.src.slice(0,58));

console.log(fallos.length ? `\nERRORES: ${fallos.join(' | ')}` : '\nSin errores de ventana.');
