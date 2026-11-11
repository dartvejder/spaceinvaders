/* Void Swarm — a dependency-free fixed shooter.
 *
 * The game runs in a fixed 360x640 portrait coordinate space that is scaled to
 * fit the window, so the same logic works on desktop and on phone screens.
 */
(() => {
  'use strict';

  const W = 360;
  const H = 640;
  const HUD_H = 32;
  const FONT = 'ui-monospace, Menlo, Consolas, "Courier New", monospace';
  const STORAGE_KEY = 'voidswarm.highscore';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ---------------------------------------------------------------- helpers

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function loadHighScore() {
    try {
      return Number(localStorage.getItem(STORAGE_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }

  function saveHighScore(v) {
    try {
      localStorage.setItem(STORAGE_KEY, String(v));
    } catch (e) {
      /* storage unavailable: high score lasts for this session only */
    }
  }

  // ------------------------------------------------------------------ audio

  const audio = {
    ctx: null,
    muted: false,
    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    },
    // Short synthesized tone that slides from `from` Hz to `to` Hz.
    tone(from, to, dur, type = 'square', vol = 0.06) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
    },
    shoot() { this.tone(880, 320, 0.09, 'square', 0.035); },
    hit() { this.tone(300, 140, 0.06, 'triangle', 0.06); },
    boom() { this.tone(220, 40, 0.22, 'sawtooth', 0.07); },
    bigBoom() { this.tone(160, 25, 0.7, 'sawtooth', 0.12); },
    power() { this.tone(440, 1320, 0.25, 'sine', 0.08); },
    hurt() { this.tone(400, 50, 0.5, 'sawtooth', 0.1); },
    wave() { this.tone(330, 990, 0.4, 'triangle', 0.07); },
  };

  // ------------------------------------------------------------------ state

  const ENEMY_TYPES = {
    dart: { hp: 1, score: 10, color: '#5cf2c4', r: 11 },
    orb: { hp: 1, score: 20, color: '#ff7ad9', r: 11 },
    hull: { hp: 3, score: 40, color: '#ffb347', r: 13 },
  };

  const POWER_TYPES = {
    rapid: { color: '#5cf2c4', label: 'R' },
    spread: { color: '#ffb347', label: 'S' },
    barrier: { color: '#6fb6ff', label: 'B' },
    life: { color: '#ff5d73', label: '+' },
  };

  const BTN_PAUSE = { x: W - 30, y: 5, w: 24, h: 22 };
  const BTN_MUTE = { x: W - 60, y: 5, w: 24, h: 22 };

  let state = 'menu'; // menu | playing | paused | gameover
  let highScore = loadHighScore();
  let score = 0;
  let wave = 0;
  let lives = 3;
  let time = 0;
  let stateTime = 0; // seconds since last state change
  let shake = 0;
  let banner = null; // { text, t }
  let newHigh = false;

  let player;
  let enemies = [];
  let boss = null;
  let shots = []; // player projectiles
  let bolts = []; // enemy projectiles
  let powerups = [];
  let particles = [];
  let formation;
  let enemyFireTimer = 0;
  let diveTimer = 0;
  let waveDelay = 0;

  const stars = [];
  for (let i = 0; i < 90; i++) {
    const depth = Math.random();
    stars.push({ x: rand(0, W), y: rand(0, H), depth, size: depth > 0.75 ? 2 : 1 });
  }

  const keys = Object.create(null);
  const pointer = { down: false, id: null, lastX: 0 };

  function setState(s) {
    state = s;
    stateTime = 0;
  }

  function newGame() {
    score = 0;
    wave = 0;
    lives = 3;
    newHigh = false;
    waveDelay = 0;
    player = {
      x: W / 2, y: H - 56, w: 26, h: 22,
      cooldown: 0, invuln: 0, rapid: 0, spread: 0, barrier: false,
    };
    enemies = [];
    boss = null;
    shots = [];
    bolts = [];
    powerups = [];
    particles = [];
    setState('playing');
    nextWave();
  }

  // ------------------------------------------------------------------ waves

  // Cell masks give successive waves different silhouettes.
  const PATTERNS = [
    () => true,
    (c, r) => (c + r) % 2 === 0,
    (c, r, cols) => Math.abs(c - (cols - 1) / 2) <= r + 1,
    (c, r, cols, rows) => c === 0 || c === cols - 1 || r === 0 || r === rows - 1 || c === (cols - 1) / 2,
  ];

  function nextWave() {
    wave++;
    bolts = [];
    formation = { x: 0, y: 0, dir: 1, total: 0 };
    enemyFireTimer = 1.2;
    diveTimer = 3;
    banner = { text: wave % 5 === 0 ? 'WARDEN INBOUND' : 'WAVE ' + wave, t: 1.8 };
    audio.wave();

    if (wave % 5 === 0) {
      const hp = 30 + wave * 5;
      boss = { x: W / 2, y: -60, targetY: 120, hp, maxHp: hp, r: 38, t: 0, fire: 2, burst: 0, flash: 0, dir: 1 };
      return;
    }

    const cols = 7;
    const rows = Math.min(3 + Math.floor(wave / 2), 6);
    const gapX = 40;
    const gapY = 34;
    const left = (W - (cols - 1) * gapX) / 2;
    const top = HUD_H + 40;
    const mask = PATTERNS[(wave - 1) % PATTERNS.length];

    for (let r = 0; r < rows; r++) {
      let type = 'dart';
      if (r === 0 && wave >= 2) type = 'hull';
      else if (r < rows / 2) type = 'orb';
      for (let c = 0; c < cols; c++) {
        if (!mask(c, r, cols, rows)) continue;
        const sx = left + c * gapX;
        const sy = top + r * gapY;
        enemies.push({
          type, sx, sy,
          x: sx, y: sy - 260 - r * 30, // fly in from above
          hp: ENEMY_TYPES[type].hp,
          mode: 'enter', // enter | form | dive | return
          phase: Math.random() * Math.PI * 2,
          flash: 0, vx: 0,
        });
      }
    }
    formation.total = enemies.length;
  }

  // --------------------------------------------------------------- spawning

  function burst(x, y, color, count, speed = 120) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(speed * 0.25, speed);
      const life = rand(0.25, 0.7);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size: rand(1.5, 3.5) });
    }
  }

  function fireBolt(x, y, vx, vy, color = '#ff5d73') {
    bolts.push({ x, y, vx, vy, r: 3.5, color });
  }

  function fireAimed(x, y, speed, color) {
    const dx = player.x - x;
    const dy = player.y - y;
    const d = Math.hypot(dx, dy) || 1;
    fireBolt(x, y, (dx / d) * speed, (dy / d) * speed, color);
  }

  function maybeDrop(x, y, guaranteed) {
    if (!guaranteed && Math.random() > 0.09) return;
    const roll = Math.random();
    let type = 'rapid';
    if (roll > 0.94) type = 'life';
    else if (roll > 0.68) type = 'barrier';
    else if (roll > 0.36) type = 'spread';
    powerups.push({ x, y, type, vy: 70, t: 0 });
  }

  // ----------------------------------------------------------------- update

  function addScore(n) {
    score += n;
    if (score > highScore) {
      highScore = score;
      newHigh = true;
    }
  }

  function playerShoot() {
    const speed = -540;
    shots.push({ x: player.x, y: player.y - 14, vx: 0, vy: speed });
    if (player.spread > 0) {
      shots.push({ x: player.x - 6, y: player.y - 10, vx: -110, vy: speed });
      shots.push({ x: player.x + 6, y: player.y - 10, vx: 110, vy: speed });
    }
    player.cooldown = player.rapid > 0 ? 0.12 : 0.27;
    audio.shoot();
  }

  function hurtPlayer() {
    if (player.invuln > 0) return;
    if (player.barrier) {
      player.barrier = false;
      player.invuln = 0.8;
      burst(player.x, player.y, '#6fb6ff', 18, 160);
      audio.hit();
      return;
    }
    lives--;
    shake = 0.45;
    burst(player.x, player.y, '#ffffff', 30, 200);
    burst(player.x, player.y, '#6fb6ff', 20, 140);
    audio.hurt();
    player.rapid = 0;
    player.spread = 0;
    if (lives <= 0) {
      gameOver();
    } else {
      player.invuln = 2.2;
      player.x = W / 2;
      bolts = [];
    }
  }

  function gameOver() {
    saveHighScore(highScore);
    setState('gameover');
  }

  function killEnemy(e) {
    const def = ENEMY_TYPES[e.type];
    addScore(def.score * (e.mode === 'dive' ? 2 : 1));
    burst(e.x, e.y, def.color, 14);
    audio.boom();
    maybeDrop(e.x, e.y, false);
    e.dead = true;
  }

  function updatePlayer(dt) {
    let dir = 0;
    if (keys.ArrowLeft || keys.KeyA) dir -= 1;
    if (keys.ArrowRight || keys.KeyD) dir += 1;
    player.x = clamp(player.x + dir * 250 * dt, 16, W - 16);

    player.cooldown -= dt;
    player.invuln = Math.max(0, player.invuln - dt);
    player.rapid = Math.max(0, player.rapid - dt);
    player.spread = Math.max(0, player.spread - dt);

    if ((keys.Space || pointer.down) && player.cooldown <= 0) playerShoot();
  }

  function updateFormation(dt) {
    const alive = enemies.length;
    if (!alive) return;

    // The swarm speeds up as it thins out.
    const thin = 1 - alive / Math.max(1, formation.total);
    const speed = (16 + wave * 2.5) * (1 + thin * 2);
    formation.x += formation.dir * speed * dt;

    let minX = Infinity;
    let maxX = -Infinity;
    for (const e of enemies) {
      minX = Math.min(minX, e.sx);
      maxX = Math.max(maxX, e.sx);
    }
    if (maxX + formation.x > W - 22 && formation.dir > 0) {
      formation.dir = -1;
      formation.y += 10;
    } else if (minX + formation.x < 22 && formation.dir < 0) {
      formation.dir = 1;
      formation.y += 10;
    }

    // Random enemy fire, biased towards the orbs, which aim.
    enemyFireTimer -= dt;
    if (enemyFireTimer <= 0) {
      enemyFireTimer = Math.max(0.35, 1.5 - wave * 0.07) * rand(0.6, 1.3);
      const formed = enemies.filter((e) => e.mode === 'form');
      if (formed.length) {
        const orbs = formed.filter((e) => e.type === 'orb');
        const e = orbs.length && Math.random() < 0.6 ? pick(orbs) : pick(formed);
        const boltSpeed = Math.min(300, 150 + wave * 7);
        if (e.type === 'orb') fireAimed(e.x, e.y + 8, boltSpeed, '#ff7ad9');
        else fireBolt(e.x, e.y + 8, 0, boltSpeed);
      }
    }

    // Darts peel off and dive at the player.
    if (wave >= 2) {
      diveTimer -= dt;
      if (diveTimer <= 0) {
        diveTimer = Math.max(1.1, 4.2 - wave * 0.22) * rand(0.7, 1.3);
        const darts = enemies.filter((e) => e.mode === 'form' && e.type === 'dart');
        if (darts.length) {
          const e = pick(darts);
          e.mode = 'dive';
          e.vx = 0;
        }
      }
    }
  }

  function updateEnemies(dt) {
    for (const e of enemies) {
      const tx = e.sx + formation.x;
      const ty = e.sy + formation.y + Math.sin(time * 2 + e.phase) * 2;
      e.flash = Math.max(0, e.flash - dt);

      if (e.mode === 'form') {
        e.x = tx;
        e.y = ty;
        if (e.y > player.y - 24) {
          // The swarm has reached the defence line.
          lives = 0;
          burst(player.x, player.y, '#ffffff', 40, 220);
          audio.hurt();
          gameOver();
          return;
        }
      } else if (e.mode === 'enter' || e.mode === 'return') {
        const k = Math.min(1, dt * 4);
        e.x += (tx - e.x) * k;
        e.y += (ty - e.y) * k + (ty > e.y ? 40 * dt : 0);
        if (Math.abs(tx - e.x) < 2 && Math.abs(ty - e.y) < 2) e.mode = 'form';
      } else if (e.mode === 'dive') {
        const steer = clamp(player.x - e.x, -1, 1) * 260;
        e.vx += (steer - e.vx) * Math.min(1, dt * 2.5);
        e.x += e.vx * dt;
        e.y += (170 + wave * 6) * dt;
        if (e.y > H + 20) {
          e.y = -30;
          e.mode = 'return';
        }
      }

      if (player.invuln <= 0 && Math.abs(e.x - player.x) < 18 && Math.abs(e.y - player.y) < 18) {
        hurtPlayer();
        if (e.mode === 'dive') killEnemy(e);
        if (state !== 'playing') return;
      }
    }
  }

  function updateBoss(dt) {
    if (!boss) return;
    boss.t += dt;
    boss.flash = Math.max(0, boss.flash - dt);

    if (boss.y < boss.targetY) {
      boss.y += 60 * dt;
      return;
    }
    const enraged = boss.hp < boss.maxHp * 0.4;
    boss.x += boss.dir * (enraged ? 95 : 60) * dt;
    if (boss.x > W - 50) boss.dir = -1;
    if (boss.x < 50) boss.dir = 1;

    const boltSpeed = Math.min(280, 150 + wave * 5);
    boss.fire -= dt;
    if (boss.fire <= 0) {
      if (boss.burst > 0) {
        // Aimed follow-up shots after a fan.
        fireAimed(boss.x, boss.y + 26, boltSpeed + 30, '#ff7ad9');
        boss.burst--;
        boss.fire = boss.burst > 0 ? 0.22 : enraged ? 0.9 : 1.4;
      } else {
        const n = enraged ? 7 : 5;
        for (let i = 0; i < n; i++) {
          const a = Math.PI / 2 + (i - (n - 1) / 2) * 0.24;
          fireBolt(boss.x, boss.y + 26, Math.cos(a) * boltSpeed, Math.sin(a) * boltSpeed, '#ffb347');
        }
        boss.burst = 3;
        boss.fire = 0.7;
      }
    }
  }

  function updateShots(dt) {
    for (const s of shots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.y < HUD_H - 10 || s.x < -10 || s.x > W + 10) {
        s.dead = true;
        continue;
      }

      if (boss && boss.y > 0 && Math.hypot(s.x - boss.x, s.y - boss.y) < boss.r) {
        s.dead = true;
        boss.hp--;
        boss.flash = 0.08;
        burst(s.x, s.y, '#ffffff', 3, 80);
        audio.hit();
        if (boss.hp <= 0) {
          addScore(500 + wave * 20);
          for (let i = 0; i < 6; i++) {
            burst(boss.x + rand(-30, 30), boss.y + rand(-24, 24), pick(['#ffb347', '#ff5d73', '#ffffff']), 22, 240);
          }
          maybeDrop(boss.x - 24, boss.y, true);
          maybeDrop(boss.x + 24, boss.y, true);
          shake = 0.7;
          audio.bigBoom();
          boss = null;
          bolts = [];
        }
        continue;
      }

      for (const e of enemies) {
        if (e.dead) continue;
        const r = ENEMY_TYPES[e.type].r;
        if (Math.abs(s.x - e.x) < r + 2 && Math.abs(s.y - e.y) < r + 4) {
          s.dead = true;
          e.hp--;
          e.flash = 0.08;
          if (e.hp <= 0) killEnemy(e);
          else audio.hit();
          break;
        }
      }
    }
  }

  function updateBolts(dt) {
    for (const b of bolts) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y > H + 10 || b.x < -10 || b.x > W + 10) {
        b.dead = true;
      } else if (Math.abs(b.x - player.x) < 10 && Math.abs(b.y - player.y) < 10) {
        b.dead = true;
        hurtPlayer();
        if (state !== 'playing') return;
      }
    }
  }

  function updatePowerups(dt) {
    for (const p of powerups) {
      p.t += dt;
      p.y += p.vy * dt;
      if (p.y > H + 20) {
        p.dead = true;
      } else if (Math.abs(p.x - player.x) < 22 && Math.abs(p.y - player.y) < 22) {
        p.dead = true;
        audio.power();
        burst(p.x, p.y, POWER_TYPES[p.type].color, 12, 100);
        addScore(25);
        if (p.type === 'rapid') player.rapid = 9;
        else if (p.type === 'spread') player.spread = 9;
        else if (p.type === 'barrier') player.barrier = true;
        else if (p.type === 'life') lives = Math.min(5, lives + 1);
      }
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.5 * dt;
      p.vy *= 1 - 1.5 * dt;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  function update(dt) {
    time += dt;
    stateTime += dt;
    shake = Math.max(0, shake - dt);
    for (const s of stars) {
      s.y += (12 + s.depth * 50) * dt;
      if (s.y > H) {
        s.y = 0;
        s.x = rand(0, W);
      }
    }

    if (state === 'paused') return;
    updateParticles(dt);
    if (state !== 'playing') return;

    if (banner) {
      banner.t -= dt;
      if (banner.t <= 0) banner = null;
    }

    updatePlayer(dt);
    updateFormation(dt);
    updateEnemies(dt);
    if (state !== 'playing') return;
    updateBoss(dt);
    updateShots(dt);
    updateBolts(dt);
    if (state !== 'playing') return;
    updatePowerups(dt);

    enemies = enemies.filter((e) => !e.dead);
    shots = shots.filter((s) => !s.dead);
    bolts = bolts.filter((b) => !b.dead);
    powerups = powerups.filter((p) => !p.dead);

    if (!enemies.length && !boss) {
      if (waveDelay <= 0) {
        waveDelay = 1.1;
        addScore(50 * wave); // clear bonus
      } else {
        waveDelay -= dt;
        if (waveDelay <= 0) nextWave();
      }
    }
  }

  // ----------------------------------------------------------------- render

  function glow(color, blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }

  function drawShip(x, y, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    glow('#6fb6ff', 12);
    ctx.fillStyle = '#dff0ff';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(5, -2);
    ctx.lineTo(13, 8);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 10);
    ctx.lineTo(-5, 6);
    ctx.lineTo(-13, 8);
    ctx.lineTo(-5, -2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6fb6ff';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(3, 1);
    ctx.lineTo(-3, 1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer() {
    if (player.invuln > 0 && Math.floor(time * 14) % 2 === 0) return;
    // Engine flame
    ctx.save();
    glow('#ffb347', 10);
    ctx.fillStyle = '#ffb347';
    const f = 5 + Math.sin(time * 40) * 2;
    ctx.beginPath();
    ctx.moveTo(player.x - 3, player.y + 8);
    ctx.lineTo(player.x, player.y + 10 + f);
    ctx.lineTo(player.x + 3, player.y + 8);
    ctx.fill();
    ctx.restore();

    drawShip(player.x, player.y);

    if (player.barrier) {
      ctx.save();
      glow('#6fb6ff', 14);
      ctx.strokeStyle = 'rgba(111,182,255,' + (0.6 + Math.sin(time * 6) * 0.2) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 21, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawEnemy(e) {
    const def = ENEMY_TYPES[e.type];
    const color = e.flash > 0 ? '#ffffff' : def.color;
    ctx.save();
    ctx.translate(e.x, e.y);
    glow(def.color, 10);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    if (e.type === 'dart') {
      // Downward-pointing arrowhead with flexing fins.
      const fin = Math.sin(time * 6 + e.phase) * 2;
      if (e.mode === 'dive') ctx.rotate(clamp(-e.vx / 400, -0.6, 0.6));
      ctx.beginPath();
      ctx.moveTo(0, 11);
      ctx.lineTo(10 + fin, -8);
      ctx.lineTo(0, -3);
      ctx.lineTo(-10 - fin, -8);
      ctx.closePath();
      ctx.fill();
    } else if (e.type === 'orb') {
      // Ringed core.
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 4 + Math.sin(time * 3 + e.phase) * 2, time + e.phase, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // Armoured hexagon; the inner plate shrinks as it takes damage.
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13);
      }
      ctx.closePath();
      ctx.stroke();
      const inner = 3 + e.hp * 2;
      ctx.fillRect(-inner, -inner, inner * 2, inner * 2);
    }
    ctx.restore();
  }

  function drawBoss() {
    if (!boss) return;
    ctx.save();
    ctx.translate(boss.x, boss.y);
    const color = boss.flash > 0 ? '#ffffff' : '#ff5d73';
    glow('#ff5d73', 18);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;

    // Rotating outer cage
    ctx.save();
    ctx.rotate(boss.t * 0.8);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      const r = i % 2 ? 38 : 28;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // Core
    ctx.beginPath();
    ctx.arc(0, 0, 14 + Math.sin(boss.t * 5) * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#05060f';
    ctx.beginPath();
    ctx.arc(0, 3, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Health bar
    const bw = 200;
    const bx = (W - bw) / 2;
    const by = HUD_H + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(bx, by, bw, 5);
    ctx.fillStyle = '#ff5d73';
    ctx.fillRect(bx, by, bw * Math.max(0, boss.hp / boss.maxHp), 5);
  }

  function drawProjectiles() {
    ctx.save();
    glow('#9fe8ff', 8);
    ctx.fillStyle = '#e6fbff';
    for (const s of shots) ctx.fillRect(s.x - 1.5, s.y - 7, 3, 12);
    for (const b of bolts) {
      glow(b.color, 10);
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPowerups() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of powerups) {
      const def = POWER_TYPES[p.type];
      ctx.save();
      ctx.translate(p.x, p.y);
      glow(def.color, 12);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2;
      ctx.save();
      ctx.rotate(p.t * 2);
      ctx.strokeRect(-9, -9, 18, 18);
      ctx.restore();
      ctx.fillStyle = def.color;
      ctx.font = 'bold 12px ' + FONT;
      ctx.fillText(def.label, 0, 1);
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    ctx.fillStyle = 'rgba(5,6,15,0.85)';
    ctx.fillRect(0, 0, W, HUD_H);
    ctx.fillStyle = 'rgba(111,182,255,0.25)';
    ctx.fillRect(0, HUD_H - 1, W, 1);

    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px ' + FONT;
    ctx.fillStyle = '#dff0ff';
    ctx.textAlign = 'left';
    ctx.fillText(String(score).padStart(6, '0'), 8, 11);
    ctx.font = '9px ' + FONT;
    ctx.fillStyle = '#7f8db3';
    ctx.fillText('HI ' + String(highScore).padStart(6, '0'), 8, 24);

    ctx.textAlign = 'center';
    ctx.font = 'bold 11px ' + FONT;
    ctx.fillStyle = '#7f8db3';
    ctx.fillText('WAVE ' + Math.max(1, wave), W / 2 - 40, 16);

    for (let i = 0; i < lives; i++) drawShip(W / 2 + 12 + i * 17, 17, 0.5);

    // Mute button
    ctx.strokeStyle = '#7f8db3';
    ctx.fillStyle = '#7f8db3';
    ctx.lineWidth = 1.5;
    const mx = BTN_MUTE.x + 6;
    const my = BTN_MUTE.y + 11;
    ctx.beginPath();
    ctx.moveTo(mx, my - 3);
    ctx.lineTo(mx + 4, my - 3);
    ctx.lineTo(mx + 9, my - 7);
    ctx.lineTo(mx + 9, my + 7);
    ctx.lineTo(mx + 4, my + 3);
    ctx.lineTo(mx, my + 3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    if (audio.muted) {
      ctx.moveTo(mx + 12, my - 4);
      ctx.lineTo(mx + 18, my + 4);
      ctx.moveTo(mx + 18, my - 4);
      ctx.lineTo(mx + 12, my + 4);
    } else {
      ctx.arc(mx + 9, my, 6, -0.8, 0.8);
    }
    ctx.stroke();

    // Pause button
    const px = BTN_PAUSE.x + 7;
    const py = BTN_PAUSE.y + 5;
    if (state === 'paused') {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + 11, py + 6);
      ctx.lineTo(px, py + 12);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(px, py, 4, 12);
      ctx.fillRect(px + 7, py, 4, 12);
    }

    // Active power-up timers along the bottom edge
    let slot = 0;
    for (const key of ['rapid', 'spread']) {
      if (player && player[key] > 0) {
        const def = POWER_TYPES[key];
        ctx.fillStyle = def.color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(8, H - 8 - slot * 6, (W - 16) * (player[key] / 9), 3);
        ctx.globalAlpha = 1;
        slot++;
      }
    }
  }

  function centerText(text, y, size, color, bold) {
    ctx.font = (bold ? 'bold ' : '') + size + 'px ' + FONT;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, y);
  }

  function drawOverlay() {
    if (state === 'playing') {
      if (banner) {
        ctx.globalAlpha = Math.min(1, banner.t * 2);
        ctx.save();
        glow('#6fb6ff', 14);
        centerText(banner.text, H * 0.42, 22, '#dff0ff', true);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      return;
    }

    ctx.fillStyle = 'rgba(5,6,15,0.72)';
    ctx.fillRect(0, HUD_H, W, H - HUD_H);
    const blink = Math.floor(time * 2) % 2 === 0;

    if (state === 'menu') {
      ctx.save();
      glow('#6fb6ff', 22);
      centerText('VOID', 190, 58, '#dff0ff', true);
      glow('#5cf2c4', 22);
      centerText('SWARM', 244, 46, '#5cf2c4', true);
      ctx.restore();
      drawShip(W / 2, 318, 1.6);
      if (blink) centerText('TAP OR PRESS ENTER', 390, 14, '#dff0ff', true);
      centerText('KEYBOARD  ← → move   SPACE fire', 448, 10, '#7f8db3');
      centerText('TOUCH  drag to move, hold to fire', 466, 10, '#7f8db3');
      centerText('P pause    M mute', 484, 10, '#7f8db3');
      centerText('R rapid  S spread  B barrier  + life', 520, 10, '#7f8db3');
      if (highScore) centerText('BEST ' + highScore, 570, 12, '#ffb347', true);
    } else if (state === 'paused') {
      centerText('PAUSED', H * 0.42, 30, '#dff0ff', true);
      centerText('tap or press P to resume', H * 0.42 + 36, 11, '#7f8db3');
    } else if (state === 'gameover') {
      ctx.save();
      glow('#ff5d73', 20);
      centerText('GAME OVER', 230, 36, '#ff5d73', true);
      ctx.restore();
      centerText('SCORE ' + score, 290, 18, '#dff0ff', true);
      centerText('WAVE ' + wave, 316, 12, '#7f8db3');
      if (newHigh) centerText('NEW BEST!', 350, 14, '#ffb347', true);
      else centerText('BEST ' + highScore, 350, 12, '#7f8db3');
      if (stateTime > 0.8 && blink) centerText('TAP OR PRESS ENTER', 420, 14, '#dff0ff', true);
    }
  }

  function render() {
    ctx.fillStyle = '#05060f';
    ctx.fillRect(0, 0, W, H);

    for (const s of stars) {
      ctx.fillStyle = 'rgba(190,210,255,' + (0.25 + s.depth * 0.6) + ')';
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }

    ctx.save();
    if (shake > 0) ctx.translate(rand(-1, 1) * shake * 10, rand(-1, 1) * shake * 10);
    if (state !== 'menu') {
      for (const e of enemies) drawEnemy(e);
      drawBoss();
      drawPowerups();
      drawProjectiles();
      if (state !== 'gameover') drawPlayer();
    }
    drawParticles();
    ctx.restore();

    drawHud();
    drawOverlay();
  }

  // ------------------------------------------------------------------ input

  function togglePause() {
    if (state === 'playing') setState('paused');
    else if (state === 'paused') setState('playing');
  }

  function toggleMute() {
    audio.muted = !audio.muted;
  }

  function confirmAction() {
    if (state === 'menu') newGame();
    else if (state === 'gameover' && stateTime > 0.8) newGame();
    else if (state === 'paused') setState('playing');
  }

  function toGame(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * W,
      y: ((ev.clientY - rect.top) / rect.height) * H,
    };
  }

  // Hit areas are padded so the small HUD buttons are comfortable on touch.
  const inside = (p, b) => p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 5 && p.y <= b.y + b.h + 10;

  canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    audio.ensure();
    const p = toGame(ev);
    if (inside(p, BTN_MUTE)) return toggleMute();
    if (inside(p, BTN_PAUSE) && (state === 'playing' || state === 'paused')) return togglePause();
    if (state !== 'playing') return confirmAction();
    pointer.down = true;
    pointer.id = ev.pointerId;
    pointer.lastX = p.x;
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!pointer.down || ev.pointerId !== pointer.id) return;
    const p = toGame(ev);
    if (state === 'playing') player.x = clamp(player.x + (p.x - pointer.lastX) * 1.25, 16, W - 16);
    pointer.lastX = p.x;
  });

  function releasePointer(ev) {
    if (ev.pointerId === pointer.id) pointer.down = false;
  }
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  window.addEventListener('keydown', (ev) => {
    if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.code)) ev.preventDefault();
    if (ev.repeat) return;
    audio.ensure();
    keys[ev.code] = true;
    if (ev.code === 'Enter' || (ev.code === 'Space' && state !== 'playing')) confirmAction();
    else if (ev.code === 'KeyP' || ev.code === 'Escape') togglePause();
    else if (ev.code === 'KeyM') toggleMute();
  });

  window.addEventListener('keyup', (ev) => {
    keys[ev.code] = false;
  });

  function autoPause() {
    pointer.down = false;
    for (const k in keys) keys[k] = false;
    if (state === 'playing') setState('paused');
  }
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) autoPause();
  });

  // ------------------------------------------------------------ boot & loop

  function resize() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Small hook for automated smoke tests.
  window.__voidSwarm = {
    get state() { return state; },
    get score() { return score; },
    get wave() { return wave; },
    get lives() { return lives; },
    get enemies() { return enemies.length; },
  };
})();
