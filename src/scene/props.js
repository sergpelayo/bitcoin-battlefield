import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import {
  BIN_WORLD,
  DATA_HALF,
  RULER_DEPTH,
  RULER_Z,
  Z_FAR,
  Z_NEAR,
  roadOffset,
  roadSlope,
} from './field.js';
import {
  createDeadPine,
  createHouse,
  createPine,
  createRuin,
  createTie,
} from './models.js';

const ROAD_Z0 = -150;
const ROAD_Z1 = 88;
const ROAD_STEPS = 160;
const TIE_COUNT = 74;

/** Cinta que sigue el terreno a lo largo de la vía. */
function makeRibbon(steps) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array((steps + 1) * 2 * 3);
  const indices = new Uint32Array(steps * 6);
  let o = 0;
  for (let i = 0; i < steps; i++) {
    const a = i * 2;
    indices[o++] = a;
    indices[o++] = a + 1;
    indices[o++] = a + 2;
    indices[o++] = a + 1;
    indices[o++] = a + 3;
    indices[o++] = a + 2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

export class Props {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.frontX = 0;

    this._buildRoad();
    this._buildVegetation();
    this._buildBuildings();
    this._buildSigns();
    this._buildRuler();

    this.setFront(0);
  }

  addTo(scene) {
    scene.add(this.group);
  }

  // --------------------------------------------------------------- vía ----
  _buildRoad() {
    const mk = (width, y, mat) => {
      const mesh = new THREE.Mesh(makeRibbon(ROAD_STEPS), mat);
      mesh.userData = { width, y };
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };

    const bedMat = new THREE.MeshStandardMaterial({
      color: 0x8d7f63,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x9aa0a6,
      roughness: 0.35,
      metalness: 0.8,
    });

    this.roadBed = mk(3.1, 0.14, bedMat);
    this.railL = mk(0.16, 0.34, railMat);
    this.railR = mk(0.16, 0.34, railMat);
    this.railL.userData.shift = -1.5;
    this.railR.userData.shift = 1.5;

    this.ties = new THREE.InstancedMesh(
      createTie(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
      TIE_COUNT,
    );
    this.ties.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ties.frustumCulled = false;
    this.group.add(this.ties);

    this._dummy = new THREE.Object3D();
  }

  setFront(x) {
    this.frontX = x;
    this._updateRibbon(this.roadBed);
    this._updateRibbon(this.railL);
    this._updateRibbon(this.railR);
    this._updateTies();
  }

  _updateRibbon(mesh) {
    const { width, y, shift = 0 } = mesh.userData;
    const pos = mesh.geometry.attributes.position;
    const arr = pos.array;
    const { terrain } = this;

    for (let i = 0; i <= ROAD_STEPS; i++) {
      const z = ROAD_Z0 + ((ROAD_Z1 - ROAD_Z0) * i) / ROAD_STEPS;
      const cx = this.frontX + roadOffset(z);
      // Perpendicular al camino en el plano XZ.
      const tx = roadSlope(z);
      const len = Math.hypot(tx, 1);
      const nx = 1 / len;
      const nz = -tx / len;

      const mx = cx + nx * shift;
      const mz = z + nz * shift;
      for (let s = 0; s < 2; s++) {
        const w = s === 0 ? -width : width;
        const px = mx + nx * w;
        const pz = mz + nz * w;
        const k = (i * 2 + s) * 3;
        arr[k] = px;
        arr[k + 1] = terrain.sample(px, pz) + y;
        arr[k + 2] = pz;
      }
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  _updateTies() {
    const d = this._dummy;
    for (let i = 0; i < TIE_COUNT; i++) {
      const z = ROAD_Z0 + ((ROAD_Z1 - ROAD_Z0) * (i + 0.5)) / TIE_COUNT;
      const cx = this.frontX + roadOffset(z);
      d.position.set(cx, this.terrain.sample(cx, z) + 0.2, z);
      d.rotation.set(0, Math.atan2(roadSlope(z), 1), 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      this.ties.setMatrixAt(i, d.matrix);
    }
    this.ties.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------- vegetación ----
  /** Muestreo por rechazo: nada dentro de lagos, de la vía ni demasiado apretado. */
  _scatter(rng, count, filter) {
    const out = [];
    let guard = 0;
    while (out.length < count && guard++ < count * 40) {
      const x = -190 + rng() * 380;
      const z = -170 + rng() * 254;
      if (this.terrain.inLake(x, z)) continue;
      if (Math.abs(x - roadOffset(z)) < 11) continue;

      // Casi nada en la franja de despliegue: las tropas tienen que verse.
      const inField = Math.abs(x) < DATA_HALF + 8 && z > Z_FAR - 10 && z < Z_NEAR + 10;
      if (inField && rng() > 0.1) continue;

      if (filter && !filter(x, z)) continue;
      out.push({ x, z, r: rng() });
    }
    return out;
  }

  _instance(geo, spots, scaleFn, rng) {
    const mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }),
      Math.max(spots.length, 1),
    );
    const d = new THREE.Object3D();
    spots.forEach((s, i) => {
      d.position.set(s.x, this.terrain.sample(s.x, s.z), s.z);
      d.rotation.set(0, rng() * Math.PI * 2, 0);
      d.scale.setScalar(scaleFn(s));
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.count = spots.length;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    return mesh;
  }

  _buildVegetation() {
    const rng = mulberry32(20260810);

    // Pinar disperso del lado toro; troncos secos del lado oso. Nunca tan denso
    // como para tapar las tropas: el dato manda sobre la ambientación.
    const lush = this._scatter(rng, 260, (x) => x < -10);
    this._instance(createPine(0x1c5c2b), lush, (s) => 0.6 + s.r * 0.7, rng);
    this._instance(
      createPine(0x2f8438),
      this._scatter(rng, 130, (x) => x < -34),
      (s) => 0.7 + s.r * 0.9,
      rng,
    );

    const dead = this._scatter(rng, 170, (x) => x > 10);
    this._instance(createDeadPine(), dead, (s) => 0.6 + s.r * 0.7, rng);
    // Unos pocos pinos resistiendo en territorio árido.
    this._instance(
      createPine(0x4a5c26),
      this._scatter(rng, 45, (x) => x > 24),
      (s) => 0.55 + s.r * 0.6,
      rng,
    );
  }

  _buildBuildings() {
    const rng = mulberry32(770077);
    const houses = this._scatter(rng, 46, (x) => x < -14);
    this._instance(createHouse(0xa89878, 0x6b3a2c), houses, (s) => 0.9 + s.r * 0.6, rng);

    const ruins = this._scatter(rng, 34, (x) => x > 14);
    this._instance(createRuin(), ruins, (s) => 0.9 + s.r * 0.7, rng);
  }

  // ------------------------------------------------------------ carteles ----
  _signTexture(label, bg, fg) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 160);
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 10;
    g.strokeRect(5, 5, 502, 150);
    g.fillStyle = fg;
    g.font = 'bold 96px ui-monospace, Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 256, 86);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  _sign(label, bg, fg, x, z, yaw) {
    const group = new THREE.Group();
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(15, 4.7),
      new THREE.MeshStandardMaterial({
        map: this._signTexture(label, bg, fg),
        roughness: 0.85,
        side: THREE.DoubleSide,
      }),
    );
    board.position.y = 7.2;
    group.add(board);

    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 1 });
    for (const px of [-5.4, 5.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 9.6, 0.7), postMat);
      post.position.set(px, 4.8, -0.2);
      group.add(post);
    }

    group.position.set(x, this.terrain.sample(x, z), z);
    group.rotation.y = yaw;
    this.group.add(group);
    return group;
  }

  _buildSigns() {
    // Lejos del borde y algo hacia el fondo: si no, los paneles del HUD los tapan.
    this._sign('BULLS', '#1d7a3f', '#eafff1', -80, 2, 0.3);
    this._sign('BEARS', '#8c2118', '#ffeceb', 80, 2, -0.3);
  }

  // --------------------------------------------------------------- regla ----
  _buildRuler() {
    const STEPS = 128;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array((STEPS + 1) * 2 * 3);
    const uvs = new Float32Array((STEPS + 1) * 2 * 2);
    const indices = new Uint32Array(STEPS * 6);

    const xMin = -DATA_HALF - 6;
    const xMax = DATA_HALF + 6;
    this.rulerRange = { xMin, xMax };

    let o = 0;
    for (let i = 0; i < STEPS; i++) {
      const a = i * 2;
      indices[o++] = a;
      indices[o++] = a + 1;
      indices[o++] = a + 2;
      indices[o++] = a + 1;
      indices[o++] = a + 3;
      indices[o++] = a + 2;
    }

    for (let i = 0; i <= STEPS; i++) {
      const x = xMin + ((xMax - xMin) * i) / STEPS;
      for (let s = 0; s < 2; s++) {
        // s = 0 -> borde lejano (v = 1, arriba en pantalla), s = 1 -> borde cercano.
        const z = RULER_Z + (s === 0 ? -RULER_DEPTH / 2 : RULER_DEPTH / 2);
        const k = (i * 2 + s) * 3;
        positions[k] = x;
        positions[k + 1] = this.terrain.sample(x, z) + 0.16;
        positions[k + 2] = z;
        const u = (i * 2 + s) * 2;
        uvs[u] = i / STEPS;
        uvs[u + 1] = s === 0 ? 1 : 0;
      }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    this.rulerCanvas = document.createElement('canvas');
    this.rulerCanvas.width = 2048;
    this.rulerCanvas.height = 128;
    this.rulerTex = new THREE.CanvasTexture(this.rulerCanvas);
    this.rulerTex.colorSpace = THREE.SRGBColorSpace;
    this.rulerTex.anisotropy = 8;

    this.ruler = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: this.rulerTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -8,
      }),
    );
    this.ruler.frustumCulled = false;
    this.group.add(this.ruler);

    this._rulerKey = '';
  }

  /** Redibuja las marcas de precio del suelo cuando cambian de verdad. */
  updateRuler(mid, binSize) {
    if (!Number.isFinite(mid) || !Number.isFinite(binSize)) return;
    const { xMin, xMax } = this.rulerRange;
    const span = ((xMax - xMin) / BIN_WORLD) * binSize;

    const steps = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500];
    const target = span / 10;
    let step = steps[steps.length - 1];
    for (const s of steps) {
      if (s >= target) {
        step = s;
        break;
      }
    }

    const first = Math.ceil((mid + (xMin / BIN_WORLD) * binSize) / step) * step;
    const key = `${first}|${step}|${Math.round(mid)}`;
    if (key === this._rulerKey) return;
    this._rulerKey = key;

    const g = this.rulerCanvas.getContext('2d');
    const W = this.rulerCanvas.width;
    const H = this.rulerCanvas.height;
    g.clearRect(0, 0, W, H);

    // Línea base continua a lo largo de toda la regla.
    g.fillStyle = 'rgba(120, 240, 176, 0.30)';
    g.fillRect(0, 6, W, 3);

    g.font = 'bold 44px ui-monospace, Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    const last = mid + (xMax / BIN_WORLD) * binSize;
    for (let p = first; p <= last; p += step) {
      const x = ((p - mid) / binSize) * BIN_WORLD;
      const u = ((x - xMin) / (xMax - xMin)) * W;
      g.fillStyle = 'rgba(150, 255, 200, 0.55)';
      g.fillRect(u - 2, 6, 4, 40);
      g.fillStyle = 'rgba(190, 255, 220, 0.92)';
      g.fillText(Math.round(p).toLocaleString('en-US'), u, 88);
    }

    // Marca del precio actual, en el centro exacto.
    const uMid = ((0 - xMin) / (xMax - xMin)) * W;
    g.fillStyle = 'rgba(255, 255, 255, 0.95)';
    g.fillRect(uMid - 3, 4, 6, 54);

    this.rulerTex.needsUpdate = true;
  }
}
