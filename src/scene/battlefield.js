import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Terrain } from './terrain.js';
import { Props } from './props.js';
import { Armies } from './armies.js';
import { FRONT_MAX } from './field.js';

const VIEW_HALF_WIDTH = 112; // media anchura de mundo que debe entrar en cuadro
const CAM_PITCH = 0.33; // ~19°: vista oblicua baja, con el horizonte en cuadro
const TARGET = new THREE.Vector3(0, 0, -22);

export class Battlefield {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = 0;
    this.pressure = 0;
    this.pressureTarget = 0;
    this.frontX = 0;
    this.bloomEnabled = true;
    this._roadFront = -999;

    this._initRenderer();
    this._initScene();

    this.terrain = new Terrain();
    this.terrain.addTo(this.scene);

    this.props = new Props(this.terrain);
    this.props.addTo(this.scene);

    this.armies = new Armies(this.terrain);
    this.armies.addTo(this.scene);

    this._initComposer();
    this._onResize();
    this.resetCamera();
    window.addEventListener('resize', () => this._onResize());
  }

  // ---------------------------------------------------------------- init ----
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x37432f, 180, 470);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.5, 1400);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 34;
    this.controls.maxDistance = 340;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.copy(TARGET);

    this.scene.add(this._sky());

    this.scene.add(new THREE.HemisphereLight(0xc2d6e4, 0x3a3020, 1.05));

    const sun = new THREE.DirectionalLight(0xfff4dc, 2.1);
    sun.position.set(-120, 110, 70);
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x8fadd0, 0.55);
    fill.position.set(110, 45, -70);
    this.scene.add(fill);

    // Resplandor del combate: un acento cálido sobre el frente, no un tinte global.
    this.frontGlow = new THREE.PointLight(0xff8a4a, 90, 62, 2);
    this.frontGlow.position.set(0, 6, -4);
    this.scene.add(this.frontGlow);
  }

  _sky() {
    return new THREE.Mesh(
      new THREE.SphereGeometry(700, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          // Cielo oscuro contra un valle brumoso: así el horizonte se recorta.
          topColor: { value: new THREE.Color(0x04070a) },
          bottomColor: { value: new THREE.Color(0x1d2b1d) },
        },
        vertexShader: `
          varying float vH;
          void main() {
            vH = normalize(position).y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 bottomColor;
          varying float vH;
          void main() {
            gl_FragColor = vec4(mix(bottomColor, topColor, smoothstep(-0.06, 0.5, vH)), 1.0);
          }`,
      }),
    );
  }

  _initComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  // ------------------------------------------------------------- público ----
  setDepth(depth) {
    this.armies.setDepth(depth);
    const total = depth.bidVol + depth.askVol;
    this.pressureTarget = total > 0 ? (depth.bidVol - depth.askVol) / total : 0;
  }

  setMarket(mid, binSize) {
    this.props.updateRuler(mid, binSize);
  }

  fireTrade(trade) {
    this.armies.fireTrade(trade);
  }

  /** Vacía el campo al cambiar de moneda. */
  reset() {
    this.armies.reset();
    this.pressureTarget = 0;
  }

  /** Avisa de cada blindado que desaparece del campo (para el sonido). */
  onUnitDestroyed(fn) {
    this.armies.onDestroy = fn;
  }

  setBloom(enabled) {
    this.bloomEnabled = enabled;
    this.bloom.enabled = enabled;
  }

  resetCamera() {
    const dist = this._fitDistance();
    this.camera.position.set(
      TARGET.x,
      TARGET.y + Math.sin(CAM_PITCH) * dist,
      TARGET.z + Math.cos(CAM_PITCH) * dist,
    );
    this.controls.target.copy(TARGET);
    this.controls.update();
  }

  // -------------------------------------------------------------- update ----
  update(dt) {
    this.time += dt;
    this.pressure += (this.pressureTarget - this.pressure) * (1 - Math.exp(-dt * 1.6));
    this.frontX = this.pressure * FRONT_MAX;

    this.terrain.setFront(this.frontX);
    // La vía se reconstruye solo cuando el frente se mueve de verdad.
    if (Math.abs(this.frontX - this._roadFront) > 0.05) {
      this.props.setFront(this.frontX);
      this._roadFront = this.frontX;
    }

    this.armies.update(dt, this.time, this.frontX, this.pressure);

    this.frontGlow.position.x = this.frontX;
    this.frontGlow.intensity = 80 + Math.sin(this.time * 3.1) * 22;

    this.controls.update();
    if (this.bloomEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // -------------------------------------------------------------- resize ----
  _size() {
    const w = this.canvas.clientWidth || window.innerWidth || 1280;
    const h = this.canvas.clientHeight || window.innerHeight || 720;
    return { w, h };
  }

  _fitDistance() {
    const { w, h } = this._size();
    const aspect = Math.max(w / h, 0.4);
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hHalf = Math.atan(Math.tan(vFov / 2) * aspect);
    const dist = VIEW_HALF_WIDTH / Math.tan(hHalf);
    return Number.isFinite(dist) ? Math.min(330, Math.max(60, dist)) : 150;
  }

  _onResize() {
    const { w, h } = this._size();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }
}
