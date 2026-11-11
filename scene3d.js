/* Void Swarm — 3D presentation layer.
 *
 * Game logic lives in game.js and works in a flat 360x640 coordinate space.
 * This module mirrors that state into a three.js scene: the playfield becomes
 * the z = 0 plane, viewed by a tilted perspective camera with a bloom pass.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const W = 360;
const H = 640;
const MAX_PARTICLES = 900;
const STAR_COUNT = 450;
const GRID_CELL = 60;

const COLORS = {
  dart: 0x5cf2c4,
  orb: 0xff7ad9,
  hull: 0xffb347,
  boss: 0xff5d73,
  player: 0x6fb6ff,
  rapid: 0x5cf2c4,
  spread: 0xffb347,
  barrier: 0x6fb6ff,
  life: 0xff5d73,
};

// Game space (y down, origin top-left) -> world space (y up, origin centre).
const wx = (gx) => gx - W / 2;
const wy = (gy) => H / 2 - gy;

function solid(color, emissive = 0.22) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: emissive,
    metalness: 0.25, roughness: 0.35, flatShading: true,
  });
}

function glowMat(color) {
  return new THREE.MeshBasicMaterial({ color });
}

export function createScene3D(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x05060f);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05060f, 1300, 2700);

  const camera = new THREE.PerspectiveCamera(40, W / H, 10, 4000);
  const camHome = new THREE.Vector3(0, -400, 850);
  const camLook = new THREE.Vector3(0, 22, 0);
  camera.position.copy(camHome);
  camera.lookAt(camLook);

  scene.add(new THREE.AmbientLight(0x8fa0d8, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(-0.5, -0.7, 1);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x6fb6ff, 1.2);
  rim.position.set(0.8, 1, 0.3);
  scene.add(rim);
  const playerLight = new THREE.PointLight(COLORS.player, 2200, 320);
  scene.add(playerLight);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.35, 0.72);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // -------------------------------------------------------------- backdrop

  const starPos = new Float32Array(STAR_COUNT * 3);
  const starSpeed = new Float32Array(STAR_COUNT);
  for (let i = 0; i < STAR_COUNT; i++) {
    starPos[i * 3] = THREE.MathUtils.randFloatSpread(1800);
    starPos[i * 3 + 1] = THREE.MathUtils.randFloat(-500, 2200);
    starPos[i * 3 + 2] = THREE.MathUtils.randFloat(-700, -160);
    starSpeed[i] = THREE.MathUtils.randFloat(20, 90);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xbcd2ff, size: 3.2, sizeAttenuation: true, transparent: true, opacity: 0.85, fog: false,
  })));

  // Scrolling floor grid far below the playfield for a sense of speed.
  const grid = new THREE.GridHelper(GRID_CELL * 60, 60, 0x1b3166, 0x1b3166);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -150;
  grid.material.transparent = true;
  grid.material.opacity = 0.8;
  scene.add(grid);

  // ---------------------------------------------------------------- player

  function buildShip() {
    const g = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0xc9d6ea, emissive: 0x24406e, emissiveIntensity: 0.25,
      metalness: 0.35, roughness: 0.3, flatShading: true,
    });
    const accent = solid(COLORS.player, 0.7);

    const body = new THREE.Mesh(new THREE.ConeGeometry(6, 32, 6), hullMat);
    body.scale.z = 0.75;
    g.add(body);

    const wing = new THREE.Shape();
    wing.moveTo(0, 6);
    wing.lineTo(18, -12);
    wing.lineTo(6, -9);
    wing.lineTo(0, -12);
    wing.lineTo(-6, -9);
    wing.lineTo(-18, -12);
    wing.closePath();
    const wings = new THREE.Mesh(new THREE.ExtrudeGeometry(wing, { depth: 2.4, bevelEnabled: false }), hullMat);
    wings.position.z = -1.6;
    g.add(wings);

    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 9, 6), accent);
      fin.position.set(side * 15.5, -9, 2.2);
      g.add(fin);
    }

    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(3, 14, 10), accent);
    cockpit.scale.set(1, 2, 0.9);
    cockpit.position.set(0, 0, 3.4);
    g.add(cockpit);

    const flame = new THREE.Mesh(new THREE.ConeGeometry(2.8, 12, 8), glowMat(0xffb347));
    flame.rotation.z = Math.PI;
    flame.position.set(0, -20, 0);
    g.add(flame);
    g.userData.flame = flame;

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(24, 28, 18),
      new THREE.MeshBasicMaterial({
        color: COLORS.barrier, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    shield.visible = false;
    g.add(shield);
    g.userData.shield = shield;
    return g;
  }

  const ship = buildShip();
  scene.add(ship);
  let lastPlayerX = W / 2;
  let bank = 0;

  // --------------------------------------------------------------- enemies

  const flashMat = glowMat(0xffffff);
  const enemyMats = {
    dart: solid(COLORS.dart),
    orb: solid(COLORS.orb, 0.4),
    hull: solid(COLORS.hull, 0.15),
    hullCore: glowMat(0xffd28a),
  };

  const dartWing = new THREE.Shape();
  dartWing.moveTo(0, -4);
  dartWing.lineTo(13, 9);
  dartWing.lineTo(0, 4);
  dartWing.lineTo(-13, 9);
  dartWing.closePath();

  const geo = {
    dartBody: new THREE.ConeGeometry(5.5, 24, 4),
    dartWing: new THREE.ExtrudeGeometry(dartWing, { depth: 2, bevelEnabled: false }),
    orbCore: new THREE.IcosahedronGeometry(6, 1),
    orbRing: new THREE.TorusGeometry(11.5, 1.3, 8, 36),
    hullBody: new THREE.CylinderGeometry(13.5, 11, 11, 6),
    hullCore: new THREE.OctahedronGeometry(1, 0),
    shot: new THREE.CapsuleGeometry(1.5, 10, 4, 8),
    bolt: new THREE.SphereGeometry(3.6, 12, 8),
    power: new THREE.OctahedronGeometry(8, 0),
    powerRing: new THREE.TorusGeometry(12, 0.8, 6, 28),
  };

  function buildEnemy(e) {
    const g = new THREE.Group();
    const parts = [];
    const add = (mesh) => {
      mesh.userData.base = mesh.material;
      parts.push(mesh);
      g.add(mesh);
      return mesh;
    };

    if (e.type === 'dart') {
      const body = add(new THREE.Mesh(geo.dartBody, enemyMats.dart));
      body.rotation.z = Math.PI; // nose towards the player
      const wings = add(new THREE.Mesh(geo.dartWing, enemyMats.dart));
      wings.position.z = -1;
    } else if (e.type === 'orb') {
      add(new THREE.Mesh(geo.orbCore, enemyMats.orb));
      g.userData.ring = add(new THREE.Mesh(geo.orbRing, enemyMats.orb));
    } else {
      const body = add(new THREE.Mesh(geo.hullBody, enemyMats.hull));
      body.rotation.x = Math.PI / 2; // hexagonal face towards the camera
      g.userData.body = body;
      const core = add(new THREE.Mesh(geo.hullCore, enemyMats.hullCore));
      core.position.z = 7;
      g.userData.core = core;
    }
    g.userData.parts = parts;
    g.scale.setScalar(1.2);
    return g;
  }

  function updateEnemy(e, g, s) {
    g.position.set(wx(e.x), wy(e.y), 0);
    const t = s.time + e.phase;
    if (e.type === 'dart') {
      if (e.mode === 'dive') {
        g.rotation.set(0.25, e.vx / 300, -e.vx / 500);
      } else {
        g.rotation.set(0, Math.sin(t * 3) * 0.45, 0);
      }
    } else if (e.type === 'orb') {
      g.userData.ring.rotation.set(t * 1.7, t * 1.1, 0);
      g.rotation.y = t * 0.8;
    } else {
      g.userData.body.rotation.y = t * 0.6;
      const c = 2 + e.hp * 1.6;
      g.userData.core.scale.set(c, c, c);
      g.userData.core.rotation.z = -t * 2;
    }
    const flashing = e.flash > 0;
    if (flashing !== g.userData.flashing) {
      g.userData.flashing = flashing;
      for (const m of g.userData.parts) m.material = flashing ? flashMat : m.userData.base;
    }
  }

  // ------------------------------------------------------------------ boss

  function buildBoss() {
    const g = new THREE.Group();
    const mat = solid(COLORS.boss, 0.3);
    const parts = [];
    const add = (mesh, parent = g) => {
      mesh.userData.base = mesh.material;
      parts.push(mesh);
      parent.add(mesh);
      return mesh;
    };
    g.userData.core = add(new THREE.Mesh(new THREE.IcosahedronGeometry(15, 0), solid(COLORS.boss, 0.9)));
    g.userData.cage = add(new THREE.Mesh(new THREE.TorusGeometry(29, 3, 6, 6), mat));
    g.userData.halo = add(new THREE.Mesh(new THREE.TorusGeometry(38, 1.6, 8, 48), mat));
    const spikes = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const spike = add(new THREE.Mesh(new THREE.ConeGeometry(4.5, 16, 4), mat), spikes);
      spike.position.set(Math.cos(a) * 38, Math.sin(a) * 38, 0);
      spike.rotation.z = a - Math.PI / 2;
    }
    g.add(spikes);
    g.userData.spikes = spikes;
    g.userData.parts = [g.userData.core]; // only the core flashes when hit
    return g;
  }

  const bossMesh = buildBoss();
  bossMesh.visible = false;
  scene.add(bossMesh);

  // ------------------------------------------------- projectiles & pickups

  const shotMat = glowMat(0xc8f6ff);
  const boltMats = new Map();
  const boltMat = (css) => {
    if (!boltMats.has(css)) boltMats.set(css, glowMat(new THREE.Color(css)));
    return boltMats.get(css);
  };
  const powerMats = {};
  for (const k of ['rapid', 'spread', 'barrier', 'life']) powerMats[k] = solid(COLORS[k], 0.6);

  function buildPower(p) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo.power, powerMats[p.type]));
    const ring = new THREE.Mesh(geo.powerRing, powerMats[p.type]);
    g.add(ring);
    g.userData.ring = ring;
    return g;
  }

  // Keeps one scene object per live game entity, creating and removing
  // objects as entities appear in and vanish from the game's lists.
  let frameId = 0;
  function sync(views, list, build, update, s) {
    for (const item of list) {
      let obj = views.get(item);
      if (!obj) {
        obj = build(item);
        scene.add(obj);
        views.set(item, obj);
      }
      obj.userData.seen = frameId;
      update(item, obj, s);
    }
    for (const [item, obj] of views) {
      if (obj.userData.seen !== frameId) {
        scene.remove(obj);
        views.delete(item);
      }
    }
  }

  const enemyViews = new Map();
  const shotViews = new Map();
  const boltViews = new Map();
  const powerViews = new Map();

  // ------------------------------------------------------------- particles

  const partPos = new Float32Array(MAX_PARTICLES * 3);
  const partCol = new Float32Array(MAX_PARTICLES * 3);
  const partGeo = new THREE.BufferGeometry();
  partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3).setUsage(THREE.DynamicDrawUsage));
  partGeo.setAttribute('color', new THREE.BufferAttribute(partCol, 3).setUsage(THREE.DynamicDrawUsage));
  const partPoints = new THREE.Points(partGeo, new THREE.PointsMaterial({
    size: 7, sizeAttenuation: true, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  partPoints.frustumCulled = false;
  scene.add(partPoints);
  const colorCache = new Map();
  const cssColor = (css) => {
    if (!colorCache.has(css)) colorCache.set(css, new THREE.Color(css));
    return colorCache.get(css);
  };

  function updateParticles(particles) {
    const n = Math.min(particles.length, MAX_PARTICLES);
    for (let i = 0; i < n; i++) {
      const p = particles[i];
      const c = cssColor(p.color);
      const a = Math.max(0, p.life / p.max);
      partPos[i * 3] = wx(p.x);
      partPos[i * 3 + 1] = wy(p.y);
      // Spread sparks in depth too, deterministically per particle.
      partPos[i * 3 + 2] = (p.vx * 0.7 - p.vy * 0.4) * (p.max - p.life);
      partCol[i * 3] = c.r * a;
      partCol[i * 3 + 1] = c.g * a;
      partCol[i * 3 + 2] = c.b * a;
    }
    partGeo.setDrawRange(0, n);
    partGeo.attributes.position.needsUpdate = true;
    partGeo.attributes.color.needsUpdate = true;
  }

  // ----------------------------------------------------------------- frame

  function updateBackdrop(dt) {
    for (let i = 0; i < STAR_COUNT; i++) {
      starPos[i * 3 + 1] -= starSpeed[i] * dt;
      if (starPos[i * 3 + 1] < -500) starPos[i * 3 + 1] = 2200;
    }
    starGeo.attributes.position.needsUpdate = true;
    grid.position.y = 900 - ((performance.now() / 1000) * 110) % GRID_CELL;
  }

  function updateShip(s, dt) {
    const p = s.player;
    const menu = s.state === 'menu';
    ship.visible = menu || (s.state !== 'gameover' && !!p && !(p.invuln > 0 && Math.floor(s.time * 14) % 2 === 0));
    const flame = ship.userData.flame;
    const f = 1 + Math.sin(s.time * 40) * 0.25;
    flame.scale.set(1, f, 1);

    if (menu || !p) {
      // Showcase the ship on the title screen.
      ship.position.set(0, wy(330), 40);
      ship.scale.setScalar(2.2);
      ship.rotation.set(-0.5, s.time * 1.2, 0);
      ship.userData.shield.visible = false;
      playerLight.position.set(0, wy(330) - 30, 90);
      lastPlayerX = W / 2;
      return;
    }

    const vx = dt > 0 ? (p.x - lastPlayerX) / dt : 0;
    lastPlayerX = p.x;
    bank += (THREE.MathUtils.clamp(vx / 260, -1, 1) - bank) * Math.min(1, dt * 10);
    ship.scale.setScalar(1);
    ship.position.set(wx(p.x), wy(p.y), 0);
    ship.rotation.set(0, bank * 0.75, -bank * 0.12);
    ship.userData.shield.visible = !!p.barrier;
    if (p.barrier) ship.userData.shield.material.opacity = 0.2 + Math.sin(s.time * 6) * 0.07;
    playerLight.position.set(wx(p.x), wy(p.y) - 10, 50);
  }

  function updateBoss(s) {
    const b = s.boss;
    bossMesh.visible = !!b && s.state !== 'menu';
    if (!b) return;
    bossMesh.position.set(wx(b.x), wy(b.y), 0);
    const u = bossMesh.userData;
    const pulse = 1 + Math.sin(b.t * 5) * 0.1;
    u.core.scale.setScalar(pulse);
    u.core.rotation.set(b.t * 0.9, b.t * 1.3, 0);
    u.cage.rotation.z = b.t * 0.8;
    u.halo.rotation.set(Math.sin(b.t * 0.7) * 0.9, b.t * 1.1, 0);
    u.spikes.rotation.z = -b.t * 0.5;
    const flashing = b.flash > 0;
    if (flashing !== u.flashing) {
      u.flashing = flashing;
      for (const m of u.parts) m.material = flashing ? flashMat : m.userData.base;
    }
  }

  let lastTime = 0;

  function render(s) {
    frameId++;
    const dt = Math.min(0.05, Math.max(0, s.time - lastTime));
    lastTime = s.time;
    const inGame = s.state !== 'menu';

    updateBackdrop(dt);
    updateShip(s, dt);
    updateBoss(s);

    sync(enemyViews, inGame ? s.enemies : [], buildEnemy, updateEnemy, s);
    sync(shotViews, inGame ? s.shots : [], () => new THREE.Mesh(geo.shot, shotMat), (o, m) => {
      m.position.set(wx(o.x), wy(o.y), 0);
      m.rotation.z = Math.atan2(-o.vx, -o.vy);
    }, s);
    sync(boltViews, inGame ? s.bolts : [], (o) => new THREE.Mesh(geo.bolt, boltMat(o.color)), (o, m) => {
      m.position.set(wx(o.x), wy(o.y), 0);
    }, s);
    sync(powerViews, inGame ? s.powerups : [], buildPower, (o, g) => {
      g.position.set(wx(o.x), wy(o.y), 0);
      g.rotation.set(o.t * 1.5, o.t * 2.2, 0);
      g.userData.ring.rotation.x = o.t * 3;
    }, s);
    updateParticles(s.particles);

    camera.position.copy(camHome);
    if (s.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * s.shake * 28;
      camera.position.y += (Math.random() - 0.5) * s.shake * 28;
    }
    camera.lookAt(camLook);
    composer.render();
  }

  function resize(cssW, cssH, dpr) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(cssW, cssH, false);
    composer.setPixelRatio(dpr);
    composer.setSize(cssW, cssH);
  }

  // Where a playfield point lands on screen, in 360x640 overlay coordinates.
  const tmp = new THREE.Vector3();
  function project(gx, gy) {
    tmp.set(wx(gx), wy(gy), 0).project(camera);
    return { x: ((tmp.x + 1) / 2) * W, y: ((1 - tmp.y) / 2) * H };
  }

  return { render, resize, project };
}
