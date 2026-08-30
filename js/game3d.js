import * as THREE from 'three';
import { createScene } from './3d/scene.js';
import { ChaseCamera } from './3d/camera.js';
import { createRoad, ROAD_WIDTH, ROAD_HALF } from './3d/road.js';
import {
  createCar, createCarFromGLTF, updateCarMesh, createTree, createSideProp, createCoin, createBoostArrow,
  createDanger, createMagnet, createCrack, createCheckerLine,
  setCarColor, getCarMaterial
} from './3d/models.js';

import { Storage } from './utils/storage.js';
import { Sounds } from './utils/sound.js';
import { initShop } from './utils/shop.js';
import { getCarById, getCarClass } from './utils/car-catalog.js';
import { runCountdown } from './utils/countdown.js';
import { YandexAds } from './utils/yandex-ads.js';

const CAR_WIDTH     = 1.6;
const CAR_LENGTH    = 3.2;
const CAR_HALF_W    = CAR_WIDTH / 2;
const PLAYABLE_HALF = ROAD_HALF - CAR_HALF_W - 0.2; 
const TREE_COUNT    = 24;   
const TREE_SPACING  = 12;   
const TREE_SIDE_OFF = ROAD_HALF + 1.5;

const COIN_COUNT    = 8;    
const EXTRA_COIN_COUNT = 16;
const DANGER_BASE   = 1;
const CRACK_BASE    = 4;
const ARROW_COUNT   = 2;

const RACE_DISTANCE = 1000;  


(async function () {
  await YandexAds.init();
  await Storage.init();
  YandexAds.notifyReady();

  const container = document.getElementById('game-canvas');
  const { renderer, scene, sunLight, ground } = createScene(container);
  const chaseCamera = new ChaseCamera(window.innerWidth / window.innerHeight);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    chaseCamera.onResize();
  });

  const road = createRoad(scene);

  let isPause = true;
  let animationId = null;
  let score = 0;
  let magnetActive = false;
  let magnetTimeout = null;
  let coinDoubleUsed = false;

  let baseSpeed = 0.15;      
  let playerMoveSpeed = 0.12;  
  let playerBoostDelta = 0;
  let playerSlowDownFrames = 0;
  let finishReached = false;
  let isInvulnerable = false;
  let playerCarClass = null;
  let playerTravelDist = 0;

  const moveState = { left: false, right: false, up: false, down: false };

  const initialCar = getCarById(Storage.get().selectedCar);
  const playerCar = createCarFromGLTF(initialCar.glb, getCarMaterial(initialCar.id));
  playerCar.position.set(0, 0, 0);
  scene.add(playerCar);

  window.addEventListener('car-changed', (e) => {
    const carData = getCarById(e.detail.carId);
    updateCarMesh(playerCar, carData.glb, getCarMaterial(carData.id));
  });

  const aiCars = [];

  class AiCar3D {
    constructor(mesh, index) {
      this.mesh = mesh;
      this.index = index;
      this.x = 0;
      this.vx = 0;
      this.travelDist = 0;

      // Unique independent bot speeds (units/frame) - 100% independent of player!
      // Bot 0: Fast racer (base speed 0.160)
      // Bot 1: Cruiser (base speed 0.142)
      const speeds = [0.160, 0.142, 0.155, 0.138];
      this.baseSpeed = speeds[index % speeds.length];
      this.currentSpeed = this.baseSpeed;

      this.stunFrames = 0;
      this.boosting = false;
      this.boostTimer = null;
      this.targetX = index % 2 === 0 ? -1.8 : 1.8;
      this.retargetTimer = 0;
      this.width = CAR_WIDTH;
      this.length = CAR_LENGTH;
    }

    place(x, startDist) {
      this.x = this._clamp(x);
      this.travelDist = startDist; // 0 at race start
      this.vx = 0;
      this.targetX = this.x;
      this._sync();
    }

    update(dangers, coins, arrows, cracks) {
      const FRICTION = 0.88;
      const STEER_FORCE = 0.025;
      const MAX_VX = 0.18;

      // Calculate independent bot speed
      let targetSpeed = this.baseSpeed;
      if (this.stunFrames > 0) {
        this.stunFrames--;
        targetSpeed = this.baseSpeed * 0.2; // Stunned by obstacle / cone (slow down to 20%)
        this.mesh.rotation.z = Math.sin(this.stunFrames * 0.6) * 0.2;
      } else if (this.boosting) {
        targetSpeed = this.baseSpeed * 1.55; // Turbo boost arrow!
      }

      this.currentSpeed += (targetSpeed - this.currentSpeed) * 0.1;
      this.travelDist += this.currentSpeed; // Move bot forward along track!

      const botZ = -this.travelDist; // 3D world position along -Z

      // Human-like AI decision tree (steering)
      if (this.stunFrames <= 0) {
        let desiredX = this.targetX;

        // 1. DANGER AVOIDANCE (Top Priority)
        let dangerAhead = false;
        if (dangers) {
          for (const d of dangers) {
            if (!d.active) continue;
            const dx = d.mesh.position.x - this.x;
            const dz = d.mesh.position.z - botZ;
            // Danger cone directly ahead within 22 units
            if (Math.abs(dx) < 1.8 && dz < 0 && dz > -22) {
              dangerAhead = true;
              const evadeDir = dx > 0 ? -1 : (dx < 0 ? 1 : (this.x > 0 ? -1 : 1));
              desiredX = this._clamp(this.x + evadeDir * 2.5);
              break;
            }
          }
        }

        // Avoid cracks / stones
        if (!dangerAhead && cracks) {
          for (const c of cracks) {
            if (!c.active) continue;
            const dx = c.mesh.position.x - this.x;
            const dz = c.mesh.position.z - botZ;
            if (Math.abs(dx) < 1.5 && dz < 0 && dz > -18) {
              dangerAhead = true;
              const evadeDir = dx > 0 ? -1 : 1;
              desiredX = this._clamp(this.x + evadeDir * 2.2);
              break;
            }
          }
        }

        // 2. ITEM HUNTING (High Priority - seek boost arrows & coins)
        if (!dangerAhead) {
          let itemFound = false;

          if (arrows) {
            for (const a of arrows) {
              if (!a.active) continue;
              const dx = a.mesh.position.x - this.x;
              const dz = a.mesh.position.z - botZ;
              if (Math.abs(dx) < 3.5 && dz < 0 && dz > -35) {
                desiredX = a.mesh.position.x;
                itemFound = true;
                break;
              }
            }
          }

          if (!itemFound && coins) {
            for (const c of coins) {
              if (!c.active) continue;
              const dx = c.mesh.position.x - this.x;
              const dz = c.mesh.position.z - botZ;
              if (Math.abs(dx) < 3.0 && dz < 0 && dz > -28) {
                desiredX = c.mesh.position.x;
                itemFound = true;
                break;
              }
            }
          }

          // 3. WANDERING (Low Priority)
          if (!itemFound) {
            if (--this.retargetTimer <= 0) {
              this.retargetTimer = 80 + Math.random() * 120;
              this.targetX = (Math.random() - 0.5) * (PLAYABLE_HALF * 1.6);
            }
            desiredX = this.targetX;
          }
        }

        // Apply smooth steering
        const dx = desiredX - this.x;
        this.vx += dx * STEER_FORCE;
        this.vx = Math.max(-MAX_VX, Math.min(MAX_VX, this.vx * FRICTION));
        this.x = this._clamp(this.x + this.vx);

        this.mesh.rotation.z = -this.vx * 2.5;
      }

      this._sync();
    }

    crash(dangerX) {
      if (this.stunFrames > 0) return;
      this.stunFrames = 80;
      const dir = this.x < dangerX ? -1 : 1;
      this.vx = dir * 0.35;
      this.targetX = this._clamp(this.x + dir * 2.5);
    }

    bump() {
      if (this.stunFrames > 0) return;
      this.stunFrames = 50;
    }

    boost() {
      if (this.boosting) return;
      this.boosting = true;
      clearTimeout(this.boostTimer);
      this.boostTimer = setTimeout(() => { this.boosting = false; }, 2500);
    }

    push(force) { this.vx += force; }

    overlaps(pos, hw, hl) {
      return (
        Math.abs(this.x - pos.x) < (this.width / 2 + hw) &&
        Math.abs(this.mesh.position.z - pos.z) < (this.length / 2 + hl)
      );
    }

    _clamp(x) {
      return Math.max(-PLAYABLE_HALF + 0.5, Math.min(PLAYABLE_HALF - 0.5, x));
    }

    _sync() {
      this.mesh.position.set(this.x, 0, -this.travelDist);
    }
  }

  const trees = [];
  for (let i = 0; i < TREE_COUNT; i++) {
    const tree = createTree(i);
    const side = i % 2 === 0 ? -1 : 1;
    const xOff = TREE_SIDE_OFF + Math.random() * 2;
    const z = -(i * TREE_SPACING / 2) + Math.random() * 3;
    tree.position.set(side * xOff, 0, z);
    const s = 0.8 + Math.random() * 0.6;
    tree.scale.set(s, s, s);
    scene.add(tree);
    trees.push(tree);
  }

  const sideProps = [];
  const SIDE_PROP_COUNT = 14;
  for (let i = 0; i < SIDE_PROP_COUNT; i++) {
    const prop = createSideProp(i);
    const side = i % 2 === 0 ? -1 : 1;
    const xOff = TREE_SIDE_OFF + 0.8 + Math.random() * 3.0;
    const z = -(i * 18) + Math.random() * 4;
    prop.position.set(side * xOff, 0, z);
    prop.rotation.y = Math.random() * Math.PI * 2;
    scene.add(prop);
    sideProps.push(prop);
  }

  function makeItem(createFn, zPos) {
    const mesh = createFn();
    mesh.position.set(
      (Math.random() - 0.5) * (ROAD_WIDTH - 2),
      0,
      zPos
    );
    scene.add(mesh);
    return { mesh, active: true, baseZ: zPos, speed: 0 };
  }

  const coins = [];
  for (let i = 0; i < COIN_COUNT; i++) {
    const c = makeItem(createCoin, -(15 + i * 12));
    c.speed = 15 + i * 12;
    coins.push(c);
  }

  const extraCoins = [];
  for (let i = 0; i < EXTRA_COIN_COUNT; i++) {
    const c = makeItem(createCoin, -9999);
    c.active = false;
    c.mesh.visible = false;
    extraCoins.push(c);
  }

  const persistentBonusCoins = [];

  const arrows = [];
  for (let i = 0; i < ARROW_COUNT; i++) {
    arrows.push(makeItem(createBoostArrow, -(50 + i * 60)));
  }

  const dangers = [];
  const cracks = [];

  const magnetItem = makeItem(createMagnet, -120);
  magnetItem.active = false;
  magnetItem.mesh.visible = false;

  const finishLineMesh = createCheckerLine(ROAD_WIDTH);
  finishLineMesh.position.set(0, 0, -9999);
  finishLineMesh.visible = false;
  scene.add(finishLineMesh);

  const startLineMesh = createCheckerLine(ROAD_WIDTH);
  scene.add(startLineMesh);

  function spawnLevelObjects() {
    const level = Storage.get().gameLevel || 1;

    dangers.forEach(d => { scene.remove(d.mesh); });
    dangers.length = 0;
    cracks.forEach(c => { scene.remove(c.mesh); });
    cracks.length = 0;

    const dangerCount = DANGER_BASE + Math.floor((level - 1) / 5);
    const crackCount = CRACK_BASE + Math.floor((level - 1) / 3);

    for (let i = 0; i < dangerCount; i++) {
      const d = makeItem(createDanger, -(60 + i * 80));
      dangers.push(d);
    }

    for (let i = 0; i < crackCount; i++) {
      const c = makeItem(createCrack, -(40 + i * 50));
      cracks.push(c);
    }

    const state = Storage.get();
    if (state.hasMagnet) {
      magnetItem.active = true;
      magnetItem.mesh.visible = true;
      magnetItem.mesh.position.set(
        (Math.random() - 0.5) * (ROAD_WIDTH - 2),
        0,
        -120
      );
    }

    persistentBonusCoins.forEach(c => scene.remove(c.mesh));
    persistentBonusCoins.length = 0;
    const bonusCount = state.coinUpgradeLevel || 0;
    for (let i = 0; i < bonusCount; i++) {
      const c = makeItem(createCoin, -(25 + i * 30));
      c.speed = 25 + i * 30;
      persistentBonusCoins.push(c);
    }
  }

  function playerOverlaps(objPos, objHalfW, objHalfL) {
    const px = playerCar.position.x;
    const pz = playerCar.position.z;
    return (
      Math.abs(px - objPos.x) < (CAR_HALF_W * 0.8 + objHalfW) &&
      Math.abs(pz - objPos.z) < (CAR_LENGTH * 0.4 + objHalfL)
    );
  }

  function spawnPopLabel(text, modifier) {
    const label = document.createElement('div');
    label.className = `pop-label pop-label--${modifier}`;
    label.textContent = text;
    label.style.left = '50%';
    label.style.top = '40%';
    label.style.transform = 'translateX(-50%)';
    document.body.appendChild(label);
    label.addEventListener('animationend', () => label.remove(), { once: true });
  }

  const gameScoreValue = document.querySelector('[data-js-game-score-value]');

  function collectCoin(item) {
    score++;
    if (gameScoreValue) gameScoreValue.innerText = score;
    spawnPopLabel('+1', 'coin');
    item.active = false;
    item.mesh.visible = false;

    if (Sounds.isPlaying) Sounds.play('coin');

    if (score % 3 === 0 && baseSpeed < 0.5) {
      baseSpeed += 0.008;
      playerMoveSpeed += 0.005;
    }
  }

  function recycleItem(item, playerZ, trackLength) {
    if (!item.active) return;
    if (item.mesh.position.z > playerZ + 15) {
      item.mesh.position.z = playerZ - trackLength;
      item.mesh.position.x = (Math.random() - 0.5) * (ROAD_WIDTH - 2);
      item.active = true;
      item.mesh.visible = true;
    }
  }


  function pullCoinToCar(item) {
    if (!item.active) return;
    const dx = playerCar.position.x - item.mesh.position.x;
    const dz = playerCar.position.z - item.mesh.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 20) {
      item.mesh.position.x += dx * 0.06;
      item.mesh.position.z += dz * 0.06;
    }
  }

  let frameCount = 0;

  function animateItems() {
    frameCount++;
    const coinAngle = frameCount * 0.05;
    [...coins, ...extraCoins, ...persistentBonusCoins].forEach(c => {
      if (c.active && c.mesh.visible) {
        c.mesh.rotation.y = coinAngle;
        c.mesh.position.y = 0.5 + Math.sin(frameCount * 0.08 + c.mesh.position.z) * 0.15;
      }
    });

    dangers.forEach(d => {
      if (d.active) {
        d.mesh.scale.set(1, 1, 1);
        if (d.mesh.userData.innerMesh) {
          d.mesh.userData.innerMesh.rotation.set(0, 0, 0);
        }
      }
    });

    arrows.forEach(a => {
      if (a.active) {
        a.mesh.rotation.y = frameCount * 0.04;
        a.mesh.position.y = 0.3 + Math.sin(frameCount * 0.06) * 0.2;
      }
    });

    if (magnetItem.active) {
      magnetItem.mesh.rotation.y = frameCount * 0.03;
      magnetItem.mesh.position.y = 0.5 + Math.sin(frameCount * 0.07) * 0.15;
    }
  }

  function recycleTrees(playerZ) {
    for (const tree of trees) {
      if (tree.position.z > playerZ + 30) {
        const minZ = Math.min(...trees.map(t => t.position.z));
        tree.position.z = minZ - TREE_SPACING / 2 - Math.random() * 3;
      }
    }
    for (const prop of sideProps) {
      if (prop.position.z > playerZ + 30) {
        const minZ = Math.min(...sideProps.map(p => p.position.z));
        prop.position.z = minZ - 18 - Math.random() * 5;
        const side = Math.random() > 0.5 ? -1 : 1;
        prop.position.x = side * (TREE_SIDE_OFF + 0.8 + Math.random() * 3.0);
        prop.rotation.y = Math.random() * Math.PI * 2;
      }
    }
  }

  function updateGround(playerZ) {
    ground.position.z = playerZ;
    sunLight.position.z = playerZ + 20;
    sunLight.target.position.z = playerZ;
    sunLight.target.updateMatrixWorld();
    if (scene.userData.skyDome) {
      scene.userData.skyDome.position.z = playerZ;
    }
  }

  function gameLoop() {
    if (isPause) return;

    const speedMod = playerSlowDownFrames > 0 ? 0.5 : 1.0;
    const currentSpeed = baseSpeed * speedMod;

    if (playerSlowDownFrames > 0) playerSlowDownFrames--;

    const lateralSpeed = playerMoveSpeed * speedMod;

    if (moveState.left)  playerCar.position.x -= lateralSpeed;
    if (moveState.right) playerCar.position.x += lateralSpeed;
    if (moveState.up)    playerCar.position.z -= lateralSpeed * 0.3;
    if (moveState.down)  playerCar.position.z += lateralSpeed * 0.3;

    playerCar.position.x = Math.max(-PLAYABLE_HALF, Math.min(PLAYABLE_HALF, playerCar.position.x));

    playerCar.position.z -= currentSpeed;
    playerTravelDist += currentSpeed;

    let targetLean = 0;
    if (moveState.left)  targetLean = 0.15;
    if (moveState.right) targetLean = -0.15;
    playerCar.rotation.z += (targetLean - playerCar.rotation.z) * 0.15;

    if (isInvulnerable) {
      playerCar.visible = Math.floor(frameCount * 0.5) % 2 === 0;
    } else {
      playerCar.visible = true;
    }

    if (playerSlowDownFrames > 0) {
      playerCar.position.y = Math.sin(frameCount * 0.3) * 0.05;
    } else {
      playerCar.position.y = 0;
    }

    coins.forEach(c => {
      if (magnetActive && c.active) pullCoinToCar(c);
      recycleItem(c, playerCar.position.z, c.speed);
      if (c.active && playerOverlaps(c.mesh.position, 0.35, 0.35)) {
        collectCoin(c);
      }
    });

    extraCoins.forEach(c => {
      if (c.active && magnetActive) pullCoinToCar(c);
      if (c.active && c.mesh.position.z > playerCar.position.z + 15) {
        c.active = false;
        c.mesh.visible = false;
      }
      if (c.active && playerOverlaps(c.mesh.position, 0.35, 0.35)) {
        collectCoin(c);
      }
    });

    // Persistent bonus coins
    persistentBonusCoins.forEach(c => {
      if (magnetActive && c.active) pullCoinToCar(c);
      recycleItem(c, playerCar.position.z, c.speed);
      if (c.active && playerOverlaps(c.mesh.position, 0.35, 0.35)) {
        collectCoin(c);
      }
    });

    // ── Arrows (boost) ──────────────────────────────────────────────────
    arrows.forEach(a => {
      recycleItem(a, playerCar.position.z, 50 + arrows.indexOf(a) * 60);
      if (a.active && playerOverlaps(a.mesh.position, 0.4, 0.6)) {
        spawnPopLabel('BOOST!', 'boost');
        a.active = false;
        a.mesh.visible = false;

        // Make dangers temporarily invisible
        dangers.forEach(d => { d.active = false; d.mesh.visible = false; });

        if (Sounds.isPlaying) Sounds.play('arrow');

        playerCar.userData.boosting = true;
        baseSpeed += 0.12;
        playerMoveSpeed += 0.05;
        playerBoostDelta = 0.08;

        setTimeout(() => {
          baseSpeed -= 0.12;
          playerMoveSpeed -= 0.05;
          playerBoostDelta = 0;
          playerCar.userData.boosting = false;
          setTimeout(() => {
            dangers.forEach(d => { d.active = true; d.mesh.visible = true; });
          }, 1000);
        }, 2000);
      }
    });

    // ── Magnet ───────────────────────────────────────────────────────────
    if (magnetItem.active) {
      recycleItem(magnetItem, playerCar.position.z, 120);
      if (playerOverlaps(magnetItem.mesh.position, 0.4, 0.4)) {
        magnetActive = true;
        clearTimeout(magnetTimeout);
        spawnExtraCoins();

        magnetTimeout = setTimeout(() => {
          magnetActive = false;
        }, 6000);

        spawnPopLabel('MAGNET!', 'boost');
        magnetItem.active = false;
        magnetItem.mesh.visible = false;
        if (Sounds.isPlaying) Sounds.play('coin');
      }
    }

    // ── Dangers ─────────────────────────────────────────────────────────
    for (const d of dangers) {
      recycleItem(d, playerCar.position.z, 60 + dangers.indexOf(d) * 80);
      if (!isInvulnerable && d.active && playerOverlaps(d.mesh.position, 0.5, 0.5)) {
        finishGame();
        return;
      }
    }

    // ── Cracks ──────────────────────────────────────────────────────────
    for (const c of cracks) {
      recycleItem(c, playerCar.position.z, 40 + cracks.indexOf(c) * 50);
      if (!isInvulnerable && c.active && playerOverlaps(c.mesh.position, 0.6, 0.6)) {
        playerSlowDownFrames = 120;
        c.active = false;
        c.mesh.visible = false;
        if (Sounds.isPlaying) Sounds.play('slow');
      }
    }

    // ── AI Cars ─────────────────────────────────────────────────────────
    aiCars.forEach(ai => {
      ai.update(dangers, coins, arrows, cracks);

      // AI-player collision (push apart)
      if (ai.overlaps(playerCar.position, CAR_HALF_W, CAR_LENGTH / 2)) {
        const dir = ai.x > playerCar.position.x ? 1 : -1;
        ai.push(dir * 0.15);
        playerCar.position.x -= dir * 0.08;
        playerCar.position.x = Math.max(-PLAYABLE_HALF, Math.min(PLAYABLE_HALF, playerCar.position.x));
      }

      // AI-danger collision
      for (const d of dangers) {
        if (d.active && ai.overlaps(d.mesh.position, 0.5, 0.5)) {
          ai.crash(d.mesh.position.x);
        }
      }

      // AI-crack collision
      for (const c of cracks) {
        if (c.active && ai.overlaps(c.mesh.position, 0.6, 0.6)) {
          ai.bump();
        }
      }

      // AI eats coins
      coins.forEach(c => {
        if (c.active && ai.overlaps(c.mesh.position, 0.35, 0.35)) {
          c.active = false;
          c.mesh.visible = false;
        }
      });

      // AI picks up arrows
      arrows.forEach(a => {
        if (a.active && ai.overlaps(a.mesh.position, 0.4, 0.6)) {
          ai.boost();
          a.active = false;
          a.mesh.visible = false;
        }
      });
    });

    // AI-AI collision
    if (aiCars.length >= 2) resolveAiAi(aiCars[0], aiCars[1]);

    // ── Finish Line ─────────────────────────────────────────────────────
    finishLineMesh.position.z = playerCar.position.z - (RACE_DISTANCE - playerTravelDist) * 0.02;

    // Finish line appears at 990 meters (10m before 1000m finish)
    const leadingDist = Math.max(
      playerTravelDist,
      ...aiCars.map(ai => ai.travelDist)
    );

    if (leadingDist >= RACE_DISTANCE - 10) {
      finishLineMesh.visible = true;
    } else {
      finishLineMesh.visible = false;
    }

    if (!finishReached && leadingDist >= RACE_DISTANCE) {
      finishReached = true;
    }

    if (finishReached) {
      baseSpeed *= 0.97;
      playerMoveSpeed *= 0.97;
      if (baseSpeed < 0.002) {
        finishRace();
        return;
      }
    }

    // ── Start line (cosmetic, moves behind) ─────────────────────────────
    startLineMesh.position.z = 0; // fixed at start

    // ── Trees, ground, road, animations ─────────────────────────────────
    recycleTrees(playerCar.position.z);
    updateGround(playerCar.position.z);
    road.update(playerCar.position.z);
    animateItems();

    // ── Sound ───────────────────────────────────────────────────────────
    if (Sounds.isPlaying) Sounds.play('main');

    // ── Camera & Render ─────────────────────────────────────────────────
    chaseCamera.update(playerCar.position);
    renderer.render(scene, chaseCamera.camera);

    animationId = requestAnimationFrame(gameLoop);
  }

  // ── Spawn extra coins (magnet) ────────────────────────────────────────

  function spawnExtraCoins() {
    extraCoins.forEach((c, i) => {
      setTimeout(() => {
        if (!magnetActive) return;
        c.mesh.position.set(
          (Math.random() - 0.5) * (ROAD_WIDTH - 2),
          0.5,
          playerCar.position.z - (10 + Math.random() * 40)
        );
        c.active = true;
        c.mesh.visible = true;
      }, i * 80);
    });
  }

  // ── AI-AI collision ───────────────────────────────────────────────────

  function resolveAiAi(a, b) {
    if (Math.abs(a.z - b.z) > CAR_LENGTH * 1.5) return;
    const dx = a.x - b.x;
    if (Math.abs(dx) < CAR_WIDTH * 1.2) {
      const dir = dx > 0 ? 1 : -1;
      a.push(dir * 0.05);
      b.push(-dir * 0.05);
    }
  }

  // ── Finish Game (crash) ───────────────────────────────────────────────

  function finishGame() {
    pauseGame();
    magnetActive = false;
    clearTimeout(magnetTimeout);
    extraCoins.forEach(c => { c.active = false; c.mesh.visible = false; });

    // Screen shake via CSS
    document.body.classList.add('screen-shake');
    document.body.addEventListener('animationend', () => {
      document.body.classList.remove('screen-shake');
    }, { once: true });

    setTimeout(() => {
      Storage.addCoins(score);
      const state = Storage.get();
      const crashLivesText = document.querySelector('[data-js-crash-lives]');
      const crashReviveBtn = document.querySelector('[data-js-crash-revive]');
      const crashModal = document.querySelector('[data-js-crash-modal]');

      if (crashLivesText) crashLivesText.textContent = state.extraLives;
      if (crashReviveBtn) {
        crashReviveBtn.style.display = state.extraLives > 0 ? 'block' : 'none';
      }
      if (crashModal) crashModal.classList.add('visible');
    }, 300);
  }

  // ── Finish Race (completed) ───────────────────────────────────────────

  function finishRace() {
    pauseGame();
    magnetActive = false;
    clearTimeout(magnetTimeout);

    Storage.addCoins(score);

    const places = [
      { label: 'You', dist: playerTravelDist },
      ...aiCars.map((ai, i) => ({
        label: `Бот ${i + 1}`,
        dist: ai.travelDist
      })),
    ].sort((a, b) => b.dist - a.dist);

    if (places[0].label === 'You') {
      const state = Storage.get();
      state.gameLevel = (state.gameLevel || 1) + 1;
      Storage.save(state);
    }

    const medals = ['🥇', '🥈', '🥉'];
    const resultListEl = document.querySelector('[data-js-result-list]');
    const raceResultEl = document.querySelector('[data-js-race-result]');

    if (resultListEl) {
      resultListEl.innerHTML = places
        .map((p, i) => `<li class="race-result__item race-result__item--${['first','second','third'][i] || ''}">
          <span>${medals[i] || (i + 1)}</span><span>${p.label}</span>
        </li>`)
        .join('');
    }

    if (raceResultEl) raceResultEl.classList.add('visible');

    coinDoubleUsed = false;
    const dcBtn = document.querySelector('[data-js-double-coins]');
    if (dcBtn) {
      dcBtn.style.display = '';
      dcBtn.disabled = false;
      dcBtn.innerHTML = '<span class="ad-btn__icon">▶</span><span>x2 монет</span>';
    }

    // Coin count-up animation
    const coinsValueEl = document.querySelector('[data-js-result-coins-value]');
    if (coinsValueEl && score > 0) {
      const totalFrames = Math.min(score, 60);
      const stepTime = Math.max(30, Math.min(80, 1200 / score));
      let current = 0;
      coinsValueEl.textContent = '0';

      const countUp = setInterval(() => {
        const step = Math.ceil((score - current) / (totalFrames - Math.min(current, totalFrames - 1)));
        current = Math.min(current + step, score);
        coinsValueEl.textContent = current;
        coinsValueEl.classList.remove('tick');
        void coinsValueEl.offsetWidth;
        coinsValueEl.classList.add('tick');

        if (Sounds.isPlaying) {
          try {
            const ding = Sounds.audio.coin.cloneNode();
            ding.volume = 0.25;
            ding.play().catch(() => {});
          } catch (_) {}
        }

        if (current >= score) {
          clearInterval(countUp);
          coinsValueEl.classList.remove('tick');
        }
      }, stepTime);
    } else if (coinsValueEl) {
      coinsValueEl.textContent = '0';
    }
  }

  // ── Pause / Resume ────────────────────────────────────────────────────

  function pauseGame() {
    if (isPause) return;
    isPause = true;
    cancelAnimationFrame(animationId);
    Sounds.pauseAll();
    YandexAds.gameplayStop();
  }

  function resumeGame() {
    if (!isPause) return;
    const welcomeScreen = document.querySelector('[data-js-welcome-screen]');
    const crashModal = document.querySelector('[data-js-crash-modal]');
    const raceResultEl = document.querySelector('[data-js-race-result]');

    if ((welcomeScreen && welcomeScreen.style.display !== 'none') ||
        (crashModal && crashModal.classList.contains('visible')) ||
        (raceResultEl && raceResultEl.classList.contains('visible'))) {
      return;
    }
    isPause = false;
    animationId = requestAnimationFrame(gameLoop);
    Sounds.resumeAll();
    YandexAds.gameplayStart();
  }

  // ── Idle render (show scene even when paused) ─────────────────────────
  function idleRender() {
    if (!isPause) return; // game loop handles rendering
    chaseCamera.update(playerCar.position);
    renderer.render(scene, chaseCamera.camera);
    requestAnimationFrame(idleRender);
  }
  idleRender();

  // ── Input Handling ────────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    if (isPause) return;
    switch (e.code) {
      case 'ArrowUp':    case 'KeyW': moveState.up = true;    break;
      case 'ArrowDown':  case 'KeyS': moveState.down = true;  break;
      case 'ArrowLeft':  case 'KeyA': moveState.left = true;  break;
      case 'ArrowRight': case 'KeyD': moveState.right = true; break;
    }
  });

  document.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowUp':    case 'KeyW': moveState.up = false;    break;
      case 'ArrowDown':  case 'KeyS': moveState.down = false;  break;
      case 'ArrowLeft':  case 'KeyA': moveState.left = false;  break;
      case 'ArrowRight': case 'KeyD': moveState.right = false; break;
    }
  });

  // Touch controls
  const controlLeft  = document.querySelector('[data-js-left-control]');
  const controlRight = document.querySelector('[data-js-right-control]');
  const controlTop   = document.querySelector('[data-js-top-control]');
  const controlDown  = document.querySelector('[data-js-down-control]');

  const touchControls = [
    { btn: controlTop,   dir: 'up' },
    { btn: controlDown,  dir: 'down' },
    { btn: controlLeft,  dir: 'left' },
    { btn: controlRight, dir: 'right' },
  ];

  touchControls.forEach(({ btn, dir }) => {
    if (!btn) return;
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); moveState[dir] = true; });
    btn.addEventListener('touchend',   ()  => { moveState[dir] = false; });
  });

  // ── DOM Event Handlers ────────────────────────────────────────────────

  const welcomeScreen = document.querySelector('[data-js-welcome-screen]');
  const welcomeStartBtn = document.querySelector('[data-js-start-game]');
  const crashModal = document.querySelector('[data-js-crash-modal]');
  const crashReviveBtn = document.querySelector('[data-js-crash-revive]');
  const crashRestartBtn = document.querySelector('[data-js-crash-restart]');
  const raceResultEl = document.querySelector('[data-js-race-result]');
  const restartButton = document.querySelector('[data-js-end-game-button]');
  const musicToggle = document.querySelector('[data-js-sound-button]');
  const gameLevelValue = document.querySelector('[data-js-game-level-value]');

  // Init sound icon
  if (musicToggle) {
    if (Sounds.isMuted) {
      musicToggle.children[0].classList.add('visually-hidden');
      musicToggle.children[1].classList.remove('visually-hidden');
    } else {
      musicToggle.children[0].classList.remove('visually-hidden');
      musicToggle.children[1].classList.add('visually-hidden');
    }
  }

  if (gameLevelValue) {
    gameLevelValue.textContent = Storage.get().gameLevel || 1;
  }

  function setupRace() {
    const state = Storage.get();
    playerCarClass = getCarClass(state.selectedCar);

    const level = state.gameLevel || 1;
    window.currentGameLevel = level;
    if (gameLevelValue) gameLevelValue.textContent = level;

    // Reset game state
    score = 0;
    playerTravelDist = 0;
    finishReached = false;
    isInvulnerable = false;
    magnetActive = false;
    playerSlowDownFrames = 0;
    playerBoostDelta = 0;
    coinDoubleUsed = false;
    if (gameScoreValue) gameScoreValue.innerText = '0';

    baseSpeed = 0.15 * playerCarClass.modifier;
    playerMoveSpeed = 0.12 * playerCarClass.modifier;

    // Speed upgrade
    const speedMult = 1 + (state.speedUpgradeLevel || 0) * 0.02;
    baseSpeed *= speedMult;
    playerMoveSpeed *= speedMult;

    // Reset player position on start line
    playerCar.position.set(0, 0, 0);

    // Apply car skin & model
    const carData = getCarById(state.selectedCar);
    updateCarMesh(playerCar, carData.glb, getCarMaterial(state.selectedCar));

    // Spawn level objects
    spawnLevelObjects();

    // Reset coins
    coins.forEach((c, i) => {
      c.active = true;
      c.mesh.visible = true;
      c.mesh.position.set(
        (Math.random() - 0.5) * (ROAD_WIDTH - 2),
        0.5,
        -(15 + i * 12)
      );
    });

    // Reset arrows
    arrows.forEach((a, i) => {
      a.active = true;
      a.mesh.visible = true;
      a.mesh.position.set(
        (Math.random() - 0.5) * (ROAD_WIDTH - 2),
        0.3,
        -(50 + i * 60)
      );
    });

    // Finish line
    finishLineMesh.position.z = -RACE_DISTANCE * 0.02;
    finishLineMesh.visible = false;

    // AI Cars - Line up side-by-side with player on start line (relZ = 0)
    aiCars.forEach(ai => scene.remove(ai.mesh));
    aiCars.length = 0;

    const aiModels = ['models/cars/police.glb', 'models/cars/race-future.glb'];
    const aiCarColors = [getCarMaterial('car_race_red'), getCarMaterial('car_race_black')];

    for (let i = 0; i < 2; i++) {
      const aiMesh = createCarFromGLTF(aiModels[i], aiCarColors[i]);
      scene.add(aiMesh);
      const ai = new AiCar3D(aiMesh, i);
      const startX = i === 0 ? -PLAYABLE_HALF * 0.6 : PLAYABLE_HALF * 0.6;
      ai.place(startX, 0); // All cars start on the exact SAME line at relZ = 0
      aiCars.push(ai);
    }

    chaseCamera.update(playerCar.position);
    renderer.render(scene, chaseCamera.camera);
  }

  // Start game
  welcomeStartBtn.addEventListener('click', () => {
    welcomeScreen.style.display = 'none';
    setupRace();

    runCountdown(() => {
      resumeGame();
    });
  });

  // Skip welcome
  if (sessionStorage.getItem('skipWelcome') === 'true') {
    sessionStorage.removeItem('skipWelcome');
    welcomeStartBtn.click();
  }

  // Crash revive (lives)
  if (crashReviveBtn) {
    crashReviveBtn.addEventListener('click', () => {
      const state = Storage.get();
      if (state.extraLives > 0) {
        state.extraLives--;
        Storage.save(state);

        dangers.forEach(d => {
          d.mesh.position.z -= 30;
          d.active = false;
          d.mesh.visible = false;
          setTimeout(() => { d.active = true; d.mesh.visible = true; }, 1500);
        });

        cracks.forEach(c => {
          c.mesh.position.z -= 30;
          c.active = false;
          c.mesh.visible = false;
          setTimeout(() => { c.active = true; c.mesh.visible = true; }, 1500);
        });

        crashModal.classList.remove('visible');
        isInvulnerable = true;
        setTimeout(() => { isInvulnerable = false; }, 2000);
        resumeGame();
      }
    });
  }

  // Crash restart
  if (crashRestartBtn) {
    crashRestartBtn.addEventListener('click', () => {
      sessionStorage.setItem('skipWelcome', 'true');
      window.location.reload();
    });
  }

  // Ad revive
  const crashReviveAdBtn = document.querySelector('[data-js-crash-revive-ad]');
  if (crashReviveAdBtn) {
    crashReviveAdBtn.addEventListener('click', () => {
      crashReviveAdBtn.disabled = true;
      crashReviveAdBtn.textContent = 'Загрузка рекламы…';

      YandexAds.showRewardedAd({
        onRewarded() {
          dangers.forEach(d => {
            d.mesh.position.z -= 30;
            d.active = false;
            d.mesh.visible = false;
            setTimeout(() => { d.active = true; d.mesh.visible = true; }, 1500);
          });
          cracks.forEach(c => {
            c.mesh.position.z -= 30;
            c.active = false;
            c.mesh.visible = false;
            setTimeout(() => { c.active = true; c.mesh.visible = true; }, 1500);
          });
          crashModal.classList.remove('visible');
          isInvulnerable = true;
          setTimeout(() => { isInvulnerable = false; }, 2000);
          resumeGame();
        },
        onClose() {
          crashReviveAdBtn.disabled = false;
          crashReviveAdBtn.innerHTML = '<span class="ad-btn__icon">▶</span><span>Возродиться</span>';
        },
        onError() {
          crashReviveAdBtn.disabled = false;
          crashReviveAdBtn.innerHTML = '<span class="ad-btn__icon">▶</span><span>Возродиться</span>';
        },
      });
    });
  }

  // Double coins ad
  const doubleCoinsBtn = document.querySelector('[data-js-double-coins]');
  if (doubleCoinsBtn) {
    doubleCoinsBtn.addEventListener('click', () => {
      if (coinDoubleUsed) return;
      doubleCoinsBtn.disabled = true;
      doubleCoinsBtn.innerHTML = '<span class="ad-btn__icon">▶</span><span>Загрузка рекламы…</span>';

      YandexAds.showRewardedAd({
        onRewarded() {
          coinDoubleUsed = true;
          Storage.addCoins(score);

          const coinsValueEl = document.querySelector('[data-js-result-coins-value]');
          if (coinsValueEl) {
            const from = score;
            const to = score * 2;
            const steps = 30;
            const delay = 40;
            let i = 0;
            const t = setInterval(() => {
              i++;
              coinsValueEl.textContent = Math.round(from + (to - from) * (i / steps));
              coinsValueEl.classList.remove('tick');
              void coinsValueEl.offsetWidth;
              coinsValueEl.classList.add('tick');
              if (Sounds.isPlaying) {
                try {
                  const ding = Sounds.audio.coin.cloneNode();
                  ding.volume = 0.2;
                  ding.play().catch(() => {});
                } catch (_) {}
              }
              if (i >= steps) {
                clearInterval(t);
                coinsValueEl.classList.remove('tick');
              }
            }, delay);
          }
          doubleCoinsBtn.style.display = 'none';
        },
        onClose() {
          if (!coinDoubleUsed) {
            doubleCoinsBtn.disabled = false;
            doubleCoinsBtn.innerHTML = '<span class="ad-btn__icon">▶</span><span>x2 монет</span>';
          }
        },
        onError() {
          if (!coinDoubleUsed) {
            doubleCoinsBtn.disabled = false;
            doubleCoinsBtn.innerHTML = '<span class="ad-btn__icon">▶</span><span>x2 монет</span>';
          }
        },
      });
    });
  }

  // Restart buttons
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-js-restart]')) {
      sessionStorage.setItem('skipWelcome', 'true');
      window.location.reload();
    }
  });

  if (restartButton) {
    restartButton.addEventListener('click', () => {
      sessionStorage.setItem('skipWelcome', 'true');
      window.location.reload();
    });
  }

  // Sound toggle
  if (musicToggle) {
    musicToggle.addEventListener('click', () => {
      Sounds.toggleMute();
      musicToggle.children[0].classList.toggle('visually-hidden');
      musicToggle.children[1].classList.toggle('visually-hidden');
    });
  }

  // Visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
  });

  // Yandex ads
  document.addEventListener('ya-ad-open', () => pauseGame());
  document.addEventListener('ya-ad-close', () => resumeGame());

  // Shop
  initShop();

  // Apply saved skin to 3D car
  const savedSkin = Storage.get().selectedCar;
  setCarColor(playerCar, savedSkin);

})();
