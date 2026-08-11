import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { BIN_WORLD, BINS, CENTER_GAP, Z_FAR, Z_NEAR, roadOffset } from './field.js';
import {
  BEAR_PALETTE,
  BULL_PALETTE,
  createPlane,
  createSoldier,
  createTank,
} from './models.js';

const SOLDIERS_PER_BIN = 26;
const TANKS_PER_BIN = 4;
const PLANES_PER_SIDE = 6;
const TRACERS = 80;
const BLASTS = 26;
const SMOKES = 42;

/**
 * Las dos fuerzas desplegadas sobre el valle.
 *
 * Cada tramo de precio del order book es una franja del terreno; el volumen de
 * ese tramo decide cuántos soldados y tanques hay plantados en él. Una pared de
 * liquidez se ve, literalmente, como una concentración de tropas.
 *
 * Las posiciones de cada plaza son fijas (se sortean una vez con semilla), así
 * que cuando el volumen sube y baja las unidades aparecen y desaparecen en su
 * sitio en vez de bailar por el campo.
 */
export class Armies {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();

    this.counts = {
      '-1': { soldiers: new Int32Array(BINS), tanks: new Int32Array(BINS) },
      1: { soldiers: new Int32Array(BINS), tanks: new Int32Array(BINS) },
    };
    this.prev = {
      '-1': { soldiers: new Int32Array(BINS), tanks: new Int32Array(BINS) },
      1: { soldiers: new Int32Array(BINS), tanks: new Int32Array(BINS) },
    };

    this.qtyRef = 1;
    this._dummy = new THREE.Object3D();
    this._hidden = new THREE.Object3D();
    this._hidden.position.set(0, -400, 0);
    this._hidden.scale.setScalar(0.0001);
    this._hidden.updateMatrix();

    this._buildTroops();
    this._buildPlanes();
    this._buildCombat();
  }

  addTo(scene) {
    scene.add(this.group);
  }

  // ------------------------------------------------------------- montaje ----
  _slots(rng, perBin, side, spread, scale) {
    const slots = [];
    const zSpan = Z_NEAR - Z_FAR;
    for (let bin = 0; bin < BINS; bin++) {
      const baseX = side * (CENTER_GAP + (bin + 0.5) * BIN_WORLD);
      // Cada tramo tiene su propio centro de agrupación: así el ejército tiene
      // silueta irregular en vez de un bloque rectangular perfecto.
      const zCenter = Z_FAR + (0.2 + rng() * 0.6) * zSpan;
      const zSpread = (0.22 + rng() * 0.3) * zSpan;

      for (let j = 0; j < perBin; j++) {
        // Suma de uniformes -> reparto acampanado alrededor del centro del grupo.
        const bell = (rng() + rng() + rng() - 1.5) / 1.5;
        const z = Math.max(Z_FAR, Math.min(Z_NEAR, zCenter + bell * zSpread));
        slots.push({
          x: baseX + (rng() - 0.5) * BIN_WORLD * spread,
          z,
          yaw: (rng() - 0.5) * 0.5,
          phase: rng() * Math.PI * 2,
          scale: scale * (0.9 + rng() * 0.25),
        });
      }
    }
    return slots;
  }

  _mesh(geo, count) {
    const mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.1 }),
      count,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    // Todo arranca oculto: el order book decide qué se ve.
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, this._hidden.matrix);
    this.group.add(mesh);
    return mesh;
  }

  _buildTroops() {
    const rng = mulberry32(31337);
    this.troops = {};
    for (const side of [-1, 1]) {
      const palette = side === -1 ? BULL_PALETTE : BEAR_PALETTE;
      this.troops[side] = {
        soldierSlots: this._slots(rng, SOLDIERS_PER_BIN, side, 0.92, 1.7),
        tankSlots: this._slots(rng, TANKS_PER_BIN, side, 0.6, 1.5),
        soldiers: this._mesh(createSoldier(palette), BINS * SOLDIERS_PER_BIN),
        tanks: this._mesh(createTank(palette), BINS * TANKS_PER_BIN),
      };
    }
  }

  _buildPlanes() {
    const rng = mulberry32(9001);
    this.planes = [];
    this.planeMeshes = [];
    for (const side of [-1, 1]) {
      const mesh = this._mesh(
        createPlane(side === -1 ? BULL_PALETTE : BEAR_PALETTE),
        PLANES_PER_SIDE,
      );
      this.planeMeshes.push(mesh);
      for (let i = 0; i < PLANES_PER_SIDE; i++) {
        this.planes.push({
          mesh,
          index: i,
          side,
          angle: rng() * Math.PI * 2,
          speed: (0.16 + rng() * 0.1) * (side === -1 ? 1 : -1),
          rx: 52 + rng() * 30,
          rz: 30 + rng() * 18,
          alt: 30 + rng() * 13,
          scale: 1 + rng() * 0.45,
        });
      }
    }
  }

  _sprite(texture, color, blending) {
    const mat = new THREE.SpriteMaterial({
      map: texture,
      color,
      blending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(0.001);
    this.group.add(s);
    return s;
  }

  _buildCombat() {
    // Trazadoras: cajas alargadas que se orientan hacia su objetivo.
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mk = (color) => {
      const mesh = new THREE.InstancedMesh(
        geo,
        new THREE.MeshBasicMaterial({
          color,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        }),
        TRACERS,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      for (let i = 0; i < TRACERS; i++) mesh.setMatrixAt(i, this._hidden.matrix);
      this.group.add(mesh);
      return {
        mesh,
        cursor: 0,
        shots: Array.from({ length: TRACERS }, () => ({
          active: false,
          t: 0,
          speed: 1,
          size: 1,
          from: new THREE.Vector3(),
          to: new THREE.Vector3(),
        })),
      };
    };
    this.tracers = { '-1': mk(0x9dffc4), 1: mk(0xffb08a) };

    const flashTex = makeGlowTexture(255, 210, 130);
    const smokeTex = makeGlowTexture(180, 180, 180, 0.55);

    this.blasts = Array.from({ length: BLASTS }, () => ({
      sprite: this._sprite(flashTex, 0xffcc88, THREE.AdditiveBlending),
      life: 0,
      size: 1,
    }));
    this._blastCursor = 0;

    this.smokes = Array.from({ length: SMOKES }, () => ({
      sprite: this._sprite(smokeTex, 0x7a7a72, THREE.NormalBlending),
      life: 0,
      size: 1,
      x: 0,
      y: 0,
      z: 0,
      rise: 1,
    }));
    this._smokeCursor = 0;
  }

  // --------------------------------------------------------------- datos ----
  /** Traduce el volumen de cada tramo del libro en tropas sobre el terreno. */
  setDepth({ bidBins, askBins, maxQty }) {
    this.qtyRef += (Math.max(maxQty, 1e-4) - this.qtyRef) * 0.08;
    const ref = Math.max(this.qtyRef, 1e-4);

    for (const side of [-1, 1]) {
      const bins = side === -1 ? bidBins : askBins;
      const c = this.counts[side];
      for (let i = 0; i < BINS; i++) {
        const n = Math.min(1, bins[i] / ref);
        // Exponente > 1: las paredes de liquidez se concentran de verdad en vez
        // de quedar todos los tramos con una densidad parecida.
        c.soldiers[i] = n > 0.04 ? Math.max(1, Math.round(Math.pow(n, 1.2) * SOLDIERS_PER_BIN)) : 0;
        c.tanks[i] = n > 0.3 ? Math.max(1, Math.round(Math.pow(n, 1.5) * TANKS_PER_BIN)) : 0;
      }
    }
  }

  /** Un trade ejecutado: el bando agresor dispara contra la línea contraria. */
  fireTrade({ isBuy, qty }) {
    const side = isBuy ? -1 : 1;
    const pool = this.tracers[side];
    const shot = pool.shots[pool.cursor];
    pool.cursor = (pool.cursor + 1) % TRACERS;

    const z = Z_FAR + Math.random() * (Z_NEAR - Z_FAR);
    const fromX = roadOffset(z) + side * (3 + Math.random() * 26);
    const toZ = z + (Math.random() - 0.5) * 16;
    const toX = roadOffset(toZ) - side * (1 + Math.random() * 14);

    shot.active = true;
    shot.t = 0;
    shot.speed = 1.5 + Math.random() * 0.9;
    shot.size = Math.min(2.4, 0.6 + Math.sqrt(qty) * 3);
    shot.from.set(fromX, this.terrain.sample(fromX, z) + 1.1, z);
    shot.to.set(toX, this.terrain.sample(toX, toZ) + 0.7, toZ);

    if (qty > 0.25) this._smoke(shot.to.x, shot.to.y, shot.to.z, 1 + Math.min(2, qty));
  }

  _blast(x, y, z, size) {
    const b = this.blasts[this._blastCursor];
    this._blastCursor = (this._blastCursor + 1) % BLASTS;
    b.life = 1;
    b.size = size;
    b.sprite.position.set(x, y, z);
  }

  _smoke(x, y, z, size) {
    const s = this.smokes[this._smokeCursor];
    this._smokeCursor = (this._smokeCursor + 1) % SMOKES;
    s.life = 1;
    s.size = size;
    s.x = x;
    s.y = y;
    s.z = z;
    s.rise = 2.5 + Math.random() * 3;
  }

  // -------------------------------------------------------------- update ----
  update(dt, time, frontX, pressure) {
    this._updateTroops(time, frontX, pressure);
    this._updatePlanes(dt, time, frontX);
    this._updateTracers(dt);
    this._updateEffects(dt);
  }

  _updateTroops(time, frontX, pressure) {
    const d = this._dummy;
    const { terrain } = this;

    for (const side of [-1, 1]) {
      const t = this.troops[side];
      const c = this.counts[side];
      const prev = this.prev[side];
      // El bando con más presión empuja hacia la línea del frente.
      const push = (side === -1 ? Math.max(0, pressure) : Math.max(0, -pressure)) * 2.6;
      const offset = frontX - side * push;

      for (let bin = 0; bin < BINS; bin++) {
        const nS = c.soldiers[bin];
        for (let j = 0; j < SOLDIERS_PER_BIN; j++) {
          const idx = bin * SOLDIERS_PER_BIN + j;
          if (j >= nS) {
            if (j < prev.soldiers[bin]) t.soldiers.setMatrixAt(idx, this._hidden.matrix);
            continue;
          }
          const s = t.soldierSlots[idx];
          // Cada unidad se pega al serpenteo de la vía: nadie pisa el territorio contrario.
          const x = s.x + offset + roadOffset(s.z);
          // Los tramos pegados al mid avanzan y retroceden: la línea respira.
          const charge = bin < 4 ? Math.sin(time * 1.6 + s.phase) * 0.5 : 0;
          const px = x - side * charge;
          d.position.set(px, terrain.sample(px, s.z) + Math.abs(Math.sin(time * 4 + s.phase)) * 0.07, s.z);
          d.rotation.set(0, side === -1 ? Math.PI / 2 + s.yaw : -Math.PI / 2 + s.yaw, 0);
          d.scale.setScalar(s.scale);
          d.updateMatrix();
          t.soldiers.setMatrixAt(idx, d.matrix);
        }
        prev.soldiers[bin] = nS;

        const nT = c.tanks[bin];
        for (let j = 0; j < TANKS_PER_BIN; j++) {
          const idx = bin * TANKS_PER_BIN + j;
          if (j >= nT) {
            if (j < prev.tanks[bin]) t.tanks.setMatrixAt(idx, this._hidden.matrix);
            continue;
          }
          const s = t.tankSlots[idx];
          const px = s.x + offset + roadOffset(s.z) + Math.sin(time * 0.5 + s.phase) * 0.6;
          d.position.set(px, terrain.sample(px, s.z), s.z);
          d.rotation.set(
            Math.sin(time * 1.3 + s.phase) * 0.03,
            side === -1 ? Math.PI / 2 + s.yaw * 0.5 : -Math.PI / 2 + s.yaw * 0.5,
            0,
          );
          d.scale.setScalar(s.scale);
          d.updateMatrix();
          t.tanks.setMatrixAt(idx, d.matrix);
        }
        prev.tanks[bin] = nT;
      }

      t.soldiers.instanceMatrix.needsUpdate = true;
      t.tanks.instanceMatrix.needsUpdate = true;
    }
  }

  _updatePlanes(dt, time, frontX) {
    const d = this._dummy;
    d.rotation.order = 'YXZ';
    for (const p of this.planes) {
      p.angle += p.speed * dt;
      const x = frontX + Math.cos(p.angle) * p.rx;
      const z = Math.sin(p.angle) * p.rz - 4;
      // Tangente de la elipse: hacia dónde apunta el morro.
      const tx = -Math.sin(p.angle) * p.rx * p.speed;
      const tz = Math.cos(p.angle) * p.rz * p.speed;

      d.position.set(x, p.alt + Math.sin(time * 0.7 + p.angle) * 1.4, z);
      d.rotation.set(0, Math.atan2(tx, tz), Math.sign(p.speed) * -0.42);
      d.scale.setScalar(p.scale);
      d.updateMatrix();
      p.mesh.setMatrixAt(p.index, d.matrix);
    }
    for (const mesh of this.planeMeshes) mesh.instanceMatrix.needsUpdate = true;
    d.rotation.order = 'XYZ';
  }

  _updateTracers(dt) {
    const d = this._dummy;
    for (const side of [-1, 1]) {
      const pool = this.tracers[side];
      let dirty = false;
      for (let i = 0; i < TRACERS; i++) {
        const s = pool.shots[i];
        if (!s.active) continue;

        s.t += dt * s.speed;
        if (s.t >= 1) {
          s.active = false;
          this._blast(s.to.x, s.to.y, s.to.z, s.size);
          pool.mesh.setMatrixAt(i, this._hidden.matrix);
          dirty = true;
          continue;
        }

        const p = s.t;
        const x = s.from.x + (s.to.x - s.from.x) * p;
        const z = s.from.z + (s.to.z - s.from.z) * p;
        const y = s.from.y + (s.to.y - s.from.y) * p + Math.sin(p * Math.PI) * 4.5;

        d.position.set(x, y, z);
        d.lookAt(s.to.x, s.to.y, s.to.z);
        d.scale.set(0.18 * s.size, 0.18 * s.size, 2.4 + s.size);
        d.updateMatrix();
        pool.mesh.setMatrixAt(i, d.matrix);
        dirty = true;
      }
      if (dirty) pool.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _updateEffects(dt) {
    for (const b of this.blasts) {
      if (b.life <= 0) continue;
      b.life -= dt * 2.6;
      const k = Math.max(0, b.life);
      b.sprite.material.opacity = k * k;
      b.sprite.scale.setScalar(b.size * (2.5 + (1 - k) * 7));
    }

    for (const s of this.smokes) {
      if (s.life <= 0) continue;
      s.life -= dt * 0.32;
      const k = Math.max(0, s.life);
      s.y += s.rise * dt;
      s.sprite.position.set(s.x, s.y, s.z);
      s.sprite.material.opacity = k * 0.5;
      s.sprite.scale.setScalar(s.size * (3 + (1 - k) * 12));
    }
  }
}

/** Textura radial suave, para fogonazos y humo. */
function makeGlowTexture(r, g, b, softness = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.35 * softness, `rgba(${r},${g},${b},0.65)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
