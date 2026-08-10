import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createBullGeometry, createBearGeometry } from './units.js';

// --- Geometría del campo -----------------------------------------------------
export const LEVELS = 20; // niveles de profundidad por bando
const LEVEL_W = 1.5; // ancho en X de cada nivel
const CENTER_GAP = 2.8; // media anchura de la tierra de nadie
const PLATEAU_D = 11; // profundidad en Z de cada meseta
const MIN_H = 0.22;
const MAX_H = 7.5;
const UNIT_SLOTS = 9; // 3 columnas x 3 filas por meseta
const FIELD_HALF = CENTER_GAP + LEVELS * LEVEL_W;

// --- Paleta ------------------------------------------------------------------
const C_BULL = 0x2bff8c;
const C_BEAR = 0xff4757;
const C_GROUND = 0x04170d;
const C_FOG = 0x03130a;

const levelX = (i, side) => side * (CENTER_GAP + LEVEL_W * (i + 0.5));

export class Battlefield {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = 0;
    this.pressure = 0; // -1 (osos) .. +1 (toros)
    this.pressureTarget = 0;
    this.qtyRef = 1; // máximo suavizado, para normalizar alturas
    this.bloomEnabled = true;

    this.bidH = new Float64Array(LEVELS).fill(MIN_H);
    this.askH = new Float64Array(LEVELS).fill(MIN_H);
    this.bidHTarget = new Float64Array(LEVELS).fill(MIN_H);
    this.askHTarget = new Float64Array(LEVELS).fill(MIN_H);
    this.bidUnits = new Int32Array(LEVELS);
    this.askUnits = new Int32Array(LEVELS);

    this._initRenderer();
    this._initScene();
    this._initGround();
    this._initPlateaus();
    this._initArmies();
    this._initFrontLine();
    this._initProjectiles();
    this._initEmbers();
    this._initComposer();

    this._dummy = new THREE.Object3D();
    this._onResize();
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
    this.renderer.toneMappingExposure = 1.05;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(C_FOG);
    this.scene.fog = new THREE.Fog(C_FOG, 55, 165);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 500);
    this.camera.position.set(0, 24, 46);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 130;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 3, 0);

    this.scene.add(new THREE.HemisphereLight(0x7fffc4, 0x04140b, 0.55));

    const key = new THREE.DirectionalLight(0xd9fff0, 1.1);
    key.position.set(-18, 34, 26);
    this.scene.add(key);

    this.bullLight = new THREE.PointLight(C_BULL, 120, 90, 2);
    this.bullLight.position.set(-14, 9, 6);
    this.scene.add(this.bullLight);

    this.bearLight = new THREE.PointLight(C_BEAR, 120, 90, 2);
    this.bearLight.position.set(14, 9, 6);
    this.scene.add(this.bearLight);
  }

  _initGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(340, 220),
      new THREE.MeshStandardMaterial({ color: C_GROUND, roughness: 0.95, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(320, 160, 0x1c5c38, 0x0d3220);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    this.scene.add(grid);
  }

  _initPlateaus() {
    // Las "paredes" del order book: una meseta por nivel cuya altura es el volumen.
    const geo = new THREE.BoxGeometry(LEVEL_W * 0.9, 1, PLATEAU_D);
    geo.translate(0, 0.5, 0); // pivote en la base, para escalar en Y hacia arriba

    const mkMat = (color, emissive) =>
      new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: 0.85,
        roughness: 0.45,
        metalness: 0.15,
        transparent: true,
        opacity: 0.92,
      });

    this.bidPlateaus = new THREE.InstancedMesh(geo, mkMat(0x0f7a49, 0x0a3f24), LEVELS);
    this.askPlateaus = new THREE.InstancedMesh(geo, mkMat(0x8f1b2a, 0x3d0a12), LEVELS);
    for (const m of [this.bidPlateaus, this.askPlateaus]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
    }
  }

  _initArmies() {
    const bullGeo = createBullGeometry();
    const bearGeo = createBearGeometry();

    const bullMat = new THREE.MeshStandardMaterial({
      color: C_BULL,
      emissive: 0x0d6b3c,
      emissiveIntensity: 0.9,
      roughness: 0.35,
      metalness: 0.25,
    });
    const bearMat = new THREE.MeshStandardMaterial({
      color: C_BEAR,
      emissive: 0x6e121c,
      emissiveIntensity: 0.9,
      roughness: 0.35,
      metalness: 0.25,
    });

    const capacity = LEVELS * UNIT_SLOTS;
    this.bulls = new THREE.InstancedMesh(bullGeo, bullMat, capacity);
    this.bears = new THREE.InstancedMesh(bearGeo, bearMat, capacity);
    for (const m of [this.bulls, this.bears]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.scene.add(m);
    }

    // Fase de animación por soldado, para que no marchen todos al unísono.
    this.phases = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) this.phases[i] = Math.random() * Math.PI * 2;
  }

  _initFrontLine() {
    // Haz vertical que marca la línea de batalla (se desplaza con la presión).
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.frontBeam = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 26), beamMat);
    this.frontBeam.position.y = 13;
    this.scene.add(this.frontBeam);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.frontRing = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.9, 48), ringMat);
    this.frontRing.rotation.x = -Math.PI / 2;
    this.frontRing.position.y = 0.05;
    this.scene.add(this.frontRing);
  }

  _initProjectiles() {
    // Un pool (y un InstancedMesh) por bando: así el color va en el material y no
    // dependemos de instanceColor, que exige vertexColors en el material.
    const MAX = 80;
    const geo = new THREE.IcosahedronGeometry(0.22, 0);

    const mkPool = (color) => {
      const mesh = new THREE.InstancedMesh(
        geo,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
        MAX,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return {
        mesh,
        cursor: 0,
        shots: Array.from({ length: MAX }, () => ({
          active: false,
          t: 0,
          speed: 1,
          from: new THREE.Vector3(),
          to: new THREE.Vector3(),
          arc: 6,
          size: 1,
        })),
      };
    };

    this.bullShots = mkPool(C_BULL);
    this.bearShots = mkPool(C_BEAR);
  }

  _initEmbers() {
    const COUNT = 420;
    const pos = new Float32Array(COUNT * 3);
    this.emberSpeed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * FIELD_HALF * 2.2;
      pos[i * 3 + 1] = Math.random() * 26;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 60;
      this.emberSpeed[i] = 0.6 + Math.random() * 1.8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.embers = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0x9dffce,
        size: 0.16,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.scene.add(this.embers);
  }

  _initComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.5, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  // -------------------------------------------------------------- público ----
  /** Recibe la profundidad ya agrupada en cubos por `OrderBook.bucketize`. */
  setDepth({ bidBins, askBins, maxQty, bidVol, askVol }) {
    // Referencia suavizada: evita que el terreno pegue saltos cuando entra una pared.
    this.qtyRef += (Math.max(maxQty, 0.0001) - this.qtyRef) * 0.08;
    const ref = Math.max(this.qtyRef, 0.0001);

    for (let i = 0; i < LEVELS; i++) {
      const nb = Math.min(1, bidBins[i] / ref);
      const na = Math.min(1, askBins[i] / ref);
      this.bidHTarget[i] = MIN_H + Math.pow(nb, 0.65) * MAX_H;
      this.askHTarget[i] = MIN_H + Math.pow(na, 0.65) * MAX_H;
      this.bidUnits[i] = nb > 0.015 ? Math.max(1, Math.round(Math.pow(nb, 0.6) * UNIT_SLOTS)) : 0;
      this.askUnits[i] = na > 0.015 ? Math.max(1, Math.round(Math.pow(na, 0.6) * UNIT_SLOTS)) : 0;
    }

    const total = bidVol + askVol;
    this.pressureTarget = total > 0 ? (bidVol - askVol) / total : 0;
  }

  /** Lanza un proyectil del bando agresor contra el contrario. */
  fireTrade({ isBuy, qty }) {
    const pool = isBuy ? this.bullShots : this.bearShots;
    const shot = pool.shots[pool.cursor];
    pool.cursor = (pool.cursor + 1) % pool.shots.length;

    const size = Math.min(2.6, 0.5 + Math.sqrt(qty) * 3.2);
    const side = isBuy ? -1 : 1;
    const fromLevel = Math.floor(Math.random() * 5);
    const fromX = levelX(fromLevel, side);
    const fromY = (isBuy ? this.bidH[fromLevel] : this.askH[fromLevel]) + 0.8;
    const toLevel = Math.floor(Math.random() * 4);
    const toX = levelX(toLevel, -side);
    const toY = (isBuy ? this.askH[toLevel] : this.bidH[toLevel]) + 0.5;

    shot.active = true;
    shot.t = 0;
    shot.speed = 0.9 + Math.random() * 0.5;
    shot.size = size;
    shot.arc = 5 + Math.random() * 5 + size;
    shot.from.set(fromX, fromY, (Math.random() - 0.5) * PLATEAU_D * 0.7);
    shot.to.set(toX, toY, (Math.random() - 0.5) * PLATEAU_D * 0.7);
  }

  setBloom(enabled) {
    this.bloomEnabled = enabled;
    this.bloom.enabled = enabled;
  }

  resetCamera() {
    this.camera.position.set(0, 24, this._fitDistance());
    this.controls.target.set(0, 3, 0);
    this.controls.update();
  }

  // -------------------------------------------------------------- update ----
  update(dt) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 6); // interpolación estable frente a dt variable

    for (let i = 0; i < LEVELS; i++) {
      this.bidH[i] += (this.bidHTarget[i] - this.bidH[i]) * k;
      this.askH[i] += (this.askHTarget[i] - this.askH[i]) * k;
    }
    this.pressure += (this.pressureTarget - this.pressure) * (1 - Math.exp(-dt * 2));

    this._updatePlateaus();
    this._updateArmies();
    this._updateFrontLine();
    this._updateProjectiles(dt);
    this._updateEmbers(dt);

    this.bullLight.intensity = 90 + Math.max(0, this.pressure) * 160;
    this.bearLight.intensity = 90 + Math.max(0, -this.pressure) * 160;

    this.controls.update();
    if (this.bloomEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  _updatePlateaus() {
    const d = this._dummy;
    for (let i = 0; i < LEVELS; i++) {
      d.position.set(levelX(i, -1), 0, 0);
      d.scale.set(1, this.bidH[i], 1);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      this.bidPlateaus.setMatrixAt(i, d.matrix);

      d.position.set(levelX(i, 1), 0, 0);
      d.scale.set(1, this.askH[i], 1);
      d.updateMatrix();
      this.askPlateaus.setMatrixAt(i, d.matrix);
    }
    this.bidPlateaus.instanceMatrix.needsUpdate = true;
    this.askPlateaus.instanceMatrix.needsUpdate = true;
  }

  _updateArmies() {
    const d = this._dummy;
    const t = this.time;

    for (const side of [-1, 1]) {
      const isBull = side === -1;
      const mesh = isBull ? this.bulls : this.bears;
      const heights = isBull ? this.bidH : this.askH;
      const counts = isBull ? this.bidUnits : this.askUnits;
      // El bando dominante avanza hacia la tierra de nadie.
      const advance = (isBull ? Math.max(0, this.pressure) : Math.max(0, -this.pressure)) * 1.6;

      let n = 0;
      for (let lvl = 0; lvl < LEVELS; lvl++) {
        const baseX = levelX(lvl, side) - side * advance;
        const y = heights[lvl];
        const active = counts[lvl];

        for (let slot = 0; slot < UNIT_SLOTS; slot++) {
          const idx = lvl * UNIT_SLOTS + slot;
          if (slot >= active) {
            d.position.set(0, -50, 0);
            d.scale.setScalar(0.0001);
            d.rotation.set(0, 0, 0);
            d.updateMatrix();
            mesh.setMatrixAt(idx, d.matrix);
            continue;
          }

          const col = slot % 3;
          const row = (slot / 3) | 0;
          const phase = this.phases[idx];
          const bob = Math.sin(t * 3.4 + phase) * 0.09;
          // Los primeros niveles cargan: oscilan hacia el centro.
          const charge = lvl < 3 ? Math.sin(t * 1.7 + phase) * 0.35 : 0;

          d.position.set(
            baseX + (col - 1) * (LEVEL_W * 0.26) - side * charge,
            y + bob,
            (row - 1) * 3.1 + Math.sin(t * 1.1 + phase) * 0.25,
          );
          d.rotation.set(0, side === -1 ? Math.PI / 2 : -Math.PI / 2, Math.sin(t * 3.4 + phase) * 0.06);
          d.scale.setScalar(0.92);
          d.updateMatrix();
          mesh.setMatrixAt(idx, d.matrix);
          n++;
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (isBull) this.bullCount = n;
      else this.bearCount = n;
    }
  }

  _updateFrontLine() {
    const x = this.pressure * CENTER_GAP * 0.85;
    this.frontBeam.position.x = x;
    this.frontBeam.lookAt(this.camera.position.x, this.frontBeam.position.y, this.camera.position.z);
    this.frontBeam.material.opacity = 0.28 + Math.abs(Math.sin(this.time * 2)) * 0.22;
    this.frontRing.position.x = x;
    const pulse = 1 + Math.sin(this.time * 2.4) * 0.12;
    this.frontRing.scale.setScalar(pulse);

    const tint = new THREE.Color(C_BEAR).lerp(new THREE.Color(C_BULL), (this.pressure + 1) / 2);
    this.frontBeam.material.color.copy(tint);
    this.frontRing.material.color.copy(tint);
  }

  _updateProjectiles(dt) {
    const d = this._dummy;
    for (const pool of [this.bullShots, this.bearShots]) {
      for (let i = 0; i < pool.shots.length; i++) {
        const s = pool.shots[i];
        if (s.active) {
          s.t += dt * s.speed;
          if (s.t >= 1) s.active = false;
        }

        if (!s.active) {
          d.position.set(0, -100, 0);
          d.rotation.set(0, 0, 0);
          d.scale.setScalar(0.0001);
          d.updateMatrix();
          pool.mesh.setMatrixAt(i, d.matrix);
          continue;
        }

        const p = s.t;
        d.position.set(
          s.from.x + (s.to.x - s.from.x) * p,
          s.from.y + (s.to.y - s.from.y) * p + Math.sin(p * Math.PI) * s.arc,
          s.from.z + (s.to.z - s.from.z) * p,
        );
        d.rotation.set(this.time * 4 + i, this.time * 3 + i, 0);
        d.scale.setScalar(s.size * (1 - p * 0.35));
        d.updateMatrix();
        pool.mesh.setMatrixAt(i, d.matrix);
      }
      pool.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _updateEmbers(dt) {
    const pos = this.embers.geometry.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < this.emberSpeed.length; i++) {
      arr[i * 3 + 1] += this.emberSpeed[i] * dt;
      if (arr[i * 3 + 1] > 28) {
        arr[i * 3 + 1] = -1;
        arr[i * 3] = (Math.random() - 0.5) * FIELD_HALF * 2.2;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 60;
      }
    }
    pos.needsUpdate = true;
  }

  // -------------------------------------------------------------- resize ----
  /**
   * Tamaño del canvas. En el primer resize (dentro del constructor) el canvas
   * todavía no tiene layout y clientWidth/clientHeight son 0: sin este fallback
   * el aspect sale 0/0 = NaN y contamina la posición de la cámara.
   */
  _size() {
    const w = this.canvas.clientWidth || window.innerWidth || 1280;
    const h = this.canvas.clientHeight || window.innerHeight || 720;
    return { w, h };
  }

  /** Distancia de cámara necesaria para que quepa todo el campo a lo ancho. */
  _fitDistance() {
    const { w, h } = this._size();
    const aspect = Math.max(w / h, 0.4);
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hHalf = Math.atan(Math.tan(vFov / 2) * aspect);
    const dist = (FIELD_HALF * 1.12) / Math.tan(hHalf);
    return Number.isFinite(dist) ? Math.min(130, Math.max(30, dist)) : 50;
  }

  _onResize() {
    const { w, h } = this._size();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);

    if (!this._didInitialFit) {
      this._didInitialFit = true;
      const dist = this._fitDistance();
      this.camera.position.set(0, dist * 0.5, dist * 0.86);
      this.controls.update();
    }
  }
}
