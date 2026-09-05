import * as THREE from 'three';
import { createScene, setRandomSkybox } from './3d/scene.js';
import { ChaseCamera } from './3d/camera.js';
import { createRoad, ROAD_WIDTH, ROAD_HALF } from './3d/road.js';
import {
  createCar, createCarFromGLTF, updateCarMesh, createTree, createSideProp, createCoin, createBoostArrow,
  createDanger, createMagnet, createCrack, createCheckerLine, createStartLine, createFinishLine,
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
const TREE_COUNT    = 60;   
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
  let dangerBoostPhase = null; // null | 'transparent' | 'blinking'
  let dangerBlinkTimer = 0;

  let baseSpeed = 0.19;      
  let playerMoveSpeed = 0.15;  
  let playerBoostDelta = 0;
  let playerSlowDownFrames = 0;
  let finishReached = false;
  let isInvulnerable = false;
  let playerCarClass = null;
  let playerTravelDist = 0;
  let lastTime = 0;
  let finishOrder = [];
  let playerFinished = false;
  let finishCountdown = -1;

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
    constructor(mesh, index, gameLevel, playerBaseSpeed) {
      this.mesh = mesh;
      this.index = index;
      this.x = 0;
      this.vx = 0;
      this.travelDist = 0;

      // Bot speeds relative to player, scaling with level (+2.5% per level)
      const speedFactors = [0.97, 0.93]; // slightly slower than player at level 1
      const levelBonus = 1 + ((gameLevel || 1) - 1) * 0.025;
      this.baseSpeed = (playerBaseSpeed || 0.1875) * speedFactors[index % speedFactors.length] * levelBonus;
      this.currentSpeed = this.baseSpeed;

      this.stunFrames = 0;
      this.boosting = false;
      this.boostTimer = null;
      this.finished = false;
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
      this.finished = false;
      this._sync();
    }

    update(playerDist, playerSpeed, playerX, dangers, coins, arrows, cracks, dt) {
      // If finished, just decelerate and coast
      if (this.finished) {
        this.currentSpeed *= Math.pow(0.95, dt);
        this.travelDist += this.currentSpeed * dt;
        this._sync();
        return;
      }

      const FRICTION = 0.88;
      const STEER_FORCE = 0.035;
      const MAX_VX = 0.22;

      // Calculate independent bot speed
      let targetSpeed = this.baseSpeed;

      // Dynamic Aggressive Catch-Up (Rubberbanding) logic
      if (typeof playerDist === 'number' && !isNaN(playerDist)) {
        const distBehind = playerDist - this.travelDist;

        if (distBehind > 14 && playerDist < RACE_DISTANCE - 20) {
          // Bot fell off-screen behind player -> snap to 6m behind player (camera view) and blast forward!
          this.travelDist = playerDist - 6;
          // Spawn in open side lane for an immediate overtake
          const side = (playerX > 0 ? -1.8 : 1.8);
          this.x = side;
          this.vx = 0;
          this.stunFrames = 0;
          targetSpeed = Math.max(this.baseSpeed * 1.8, (playerSpeed || 0.2) * 1.4);
        } else if (distBehind > 0.5) {
          // Reduce rubberbanding near finish for fair final stretch
          const raceProgress = this.travelDist / RACE_DISTANCE;
          if (raceProgress > 0.9) {
            // Last 10%: cap speed to player speed (no overtake from behind via rubberbanding)
            targetSpeed = Math.max(this.baseSpeed, playerSpeed || 0.2);
          } else if (raceProgress > 0.8) {
            // 80-90%: dampened catch-up
            const dampening = Math.max(0, 1 - (raceProgress - 0.8) / 0.1);
            const catchupMult = 1 + 0.6 * dampening;
            const speedMult = 1 + 0.28 * dampening;
            targetSpeed = Math.max(this.baseSpeed * catchupMult, (playerSpeed || 0.2) * speedMult);
          } else {
            // Normal catch-up
            targetSpeed = Math.max(this.baseSpeed * 1.6, (playerSpeed || 0.2) * 1.28);
          }
          
          // Steer towards open lane next to player for overtake
          if (Math.abs(this.x - (playerX || 0)) < 1.2 && this.stunFrames <= 0) {
            const evadeDir = (this.x > (playerX || 0)) ? 1 : -1;
            this.targetX = this._clamp((playerX || 0) + evadeDir * 2.2);
          }
        } else if (distBehind < -25) {
          // Bot is far ahead (> 25m) -> ease up slightly so player can fight back!
          targetSpeed = this.baseSpeed * 0.85;
        }
      }

      if (this.stunFrames > 0) {
        this.stunFrames -= dt;
        targetSpeed = this.baseSpeed * 0.25;
        this.mesh.rotation.z = Math.sin(this.stunFrames * 0.6) * 0.2;
      } else if (this.boosting) {
        targetSpeed = Math.max(this.baseSpeed * 1.7, (playerSpeed || 0.2) * 1.45);
      }

      this.currentSpeed += (targetSpeed - this.currentSpeed) * 0.12 * dt;
      this.travelDist += this.currentSpeed * dt; // Move bot forward along track!

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
            if ((this.retargetTimer -= dt) <= 0) {
              this.retargetTimer = 80 + Math.random() * 120;
              this.targetX = (Math.random() - 0.5) * (PLAYABLE_HALF * 1.6);
            }
            desiredX = this.targetX;
          }
        }

        // Apply smooth steering
        const dx = desiredX - this.x;
        this.vx += dx * STEER_FORCE * dt;
        this.vx = Math.max(-MAX_VX, Math.min(MAX_VX, this.vx * Math.pow(FRICTION, dt)));
        this.x = this._clamp(this.x + this.vx * dt);

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
    // Spread trees up to 25 units away
    const xOff = TREE_SIDE_OFF + Math.random() * 25.0;
    const z = -(i * TREE_SPACING / 2) + Math.random() * 3;
    tree.position.set(side * xOff, 0, z);
    const s = 0.8 + Math.random() * 0.6;
    tree.scale.set(s, s, s);
    scene.add(tree);
    trees.push(tree);
  }

  const sideProps = [];
  const SIDE_PROP_COUNT = 80;
  for (let i = 0; i < SIDE_PROP_COUNT; i++) {
    const prop = createSideProp(i);
    const side = i % 2 === 0 ? -1 : 1;
    // Spread props up to 30 units away
    const xOff = TREE_SIDE_OFF + 0.5 + Math.random() * 30.0;
    const z = -(i * 4) + Math.random() * 4;
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

  const finishLineMesh = createFinishLine(ROAD_WIDTH);
  finishLineMesh.position.set(0, 0, -9999);
  finishLineMesh.visible = false;
  scene.add(finishLineMesh);

  const startLineMesh = createStartLine(ROAD_WIDTH);
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

  function setDangerOpacity(meshGroup, opacity) {
    meshGroup.traverse(child => {
      if (child.isMesh && child.material) {
        // Clone material on first use to avoid affecting shared materials
        if (!child.material.userData._opacityCloned) {
          child.material = child.material.clone();
          child.material.userData._opacityCloned = true;
        }
        child.material.transparent = opacity < 1.0;
        child.material.opacity = opacity;
      }
    });
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
    if (item.mesh.position.z > playerZ + 15) {
      const dist = (typeof trackLength === 'number' && !isNaN(trackLength) && trackLength > 0)
        ? trackLength
        : (70 + Math.random() * 50);
      item.mesh.position.z = playerZ - dist;
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
      // Blinking animation during pre-reappear phase
      if (dangerBoostPhase === 'blinking') {
        // Oscillate opacity: fast blink getting more opaque over time
        const progress = 1 - (dangerBlinkTimer / 180); // 0→1 over 3 seconds
        const blinkSpeed = 8 + progress * 12; // faster blink as time progresses
        const minOpacity = 0.15 + progress * 0.35; // 0.15→0.5
        const maxOpacity = 0.4 + progress * 0.5;   // 0.4→0.9
        const blink = (Math.sin(frameCount * 0.1 * blinkSpeed) + 1) / 2;
        const opacity = minOpacity + blink * (maxOpacity - minOpacity);
        setDangerOpacity(d.mesh, opacity);
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
        const side = Math.random() > 0.5 ? -1 : 1;
        tree.position.x = side * (TREE_SIDE_OFF + Math.random() * 25.0);
      }
    }
    for (const prop of sideProps) {
      if (prop.position.z > playerZ + 30) {
        const minZ = Math.min(...sideProps.map(p => p.position.z));
        prop.position.z = minZ - 4 - Math.random() * 5;
        const side = Math.random() > 0.5 ? -1 : 1;
        prop.position.x = side * (TREE_SIDE_OFF + 0.5 + Math.random() * 30.0);
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

  function gameLoop(timestamp) {
    if (isPause) return;

    // Delta-time: normalize to 60fps (dt=1.0 at 60fps, dt=2.0 at 30fps)
    if (!lastTime) lastTime = timestamp;
    const dt = Math.min((timestamp - lastTime) / 16.667, 3);
    lastTime = timestamp;

    const speedMod = playerSlowDownFrames > 0 ? 0.5 : 1.0;
    const currentSpeed = baseSpeed * speedMod;

    if (playerSlowDownFrames > 0) playerSlowDownFrames -= dt;

    const lateralSpeed = playerMoveSpeed * speedMod;

    if (moveState.left)  playerCar.position.x -= lateralSpeed * dt;
    if (moveState.right) playerCar.position.x += lateralSpeed * dt;
    if (moveState.up)    playerCar.position.z -= lateralSpeed * 0.3 * dt;
    if (moveState.down)  playerCar.position.z += lateralSpeed * 0.3 * dt;

    playerCar.position.x = Math.max(-PLAYABLE_HALF, Math.min(PLAYABLE_HALF, playerCar.position.x));

    playerCar.position.z -= currentSpeed * dt;
    playerTravelDist += currentSpeed * dt;

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

    coins.forEach((c, i) => {
      if (magnetActive && c.active) pullCoinToCar(c);
      recycleItem(c, playerCar.position.z, 60 + i * 15);
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

        // Make dangers semi-transparent and inactive (no collision)
        dangerBoostPhase = 'transparent';
        dangers.forEach(d => {
          d.active = false;
          d.mesh.visible = true;
          setDangerOpacity(d.mesh, 0.2);
        });

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

          // Start 3-second blinking phase before full reappear
          dangerBoostPhase = 'blinking';
          dangerBlinkTimer = 180; // ~3 seconds (60fps-normalized)
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

    // ── Danger blink countdown ──────────────────────────────────────────
    if (dangerBoostPhase === 'blinking') {
      dangerBlinkTimer -= dt;
      if (dangerBlinkTimer <= 0) {
        // Fully reappear: solid and active
        dangerBoostPhase = null;
        dangers.forEach(d => {
          d.active = true;
          d.mesh.visible = true;
          setDangerOpacity(d.mesh, 1.0);
        });
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
      ai.update(playerTravelDist, currentSpeed, playerCar.position.x, dangers, coins, arrows, cracks, dt);

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
    // Position the finish line relative to the player so it stays within camera range (far=300)
    const distToFinish = RACE_DISTANCE - playerTravelDist;
    if (distToFinish > 0) {
      finishLineMesh.position.z = playerCar.position.z - Math.min(distToFinish, 200);
    } else {
      finishLineMesh.position.z = playerCar.position.z; // player crossed it
    }

    // Finish line appears when player is within 25m of race distance
    if (playerTravelDist >= RACE_DISTANCE - 25) {
      finishLineMesh.visible = true;
    } else {
      finishLineMesh.visible = false;
    }

    // Debug: log positions every ~2 seconds near finish
    if (playerTravelDist > RACE_DISTANCE * 0.9 && frameCount % 120 === 0) {
      console.log(`[RACE] Player: ${playerTravelDist.toFixed(1)} | ${aiCars.map((ai, i) => `Bot${i+1}: ${ai.travelDist.toFixed(1)}${ai.finished ? '(F)' : ''}`).join(' | ')}`);
    }

    // Track individual finishes
    if (!playerFinished && playerTravelDist >= RACE_DISTANCE) {
      playerFinished = true;
      finishOrder.push({ label: 'Вы', dist: playerTravelDist });
      console.log(`[FINISH] Вы финишировали! Позиция: ${finishOrder.length}, dist: ${playerTravelDist.toFixed(1)}`);
    }
    aiCars.forEach((ai, i) => {
      if (!ai.finished && ai.travelDist >= RACE_DISTANCE) {
        ai.finished = true;
        finishOrder.push({ label: `Бот ${i + 1}`, dist: ai.travelDist });
        console.log(`[FINISH] Бот ${i + 1} финишировал! Позиция: ${finishOrder.length}, dist: ${ai.travelDist.toFixed(1)}`);
      }
    });

    // Start countdown when first racer finishes
    if (finishOrder.length > 0 && finishCountdown < 0) {
      finishReached = true;
      finishCountdown = 300; // ~5 seconds (in 60fps-normalized frames)
    }

    if (finishReached) {
      finishCountdown -= dt;
      baseSpeed *= Math.pow(0.97, dt);
      playerMoveSpeed *= Math.pow(0.97, dt);

      // End race when all finished or countdown expired
      if (finishOrder.length >= aiCars.length + 1 || finishCountdown <= 0 || baseSpeed < 0.002) {
        // Add any remaining racers who didn't cross the line
        if (!playerFinished) {
          finishOrder.push({ label: 'Вы', dist: playerTravelDist });
        }
        aiCars.forEach((ai, i) => {
          if (!ai.finished) {
            finishOrder.push({ label: `Бот ${i + 1}`, dist: ai.travelDist });
          }
        });
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
    if (scene.userData.skyDome) {
      scene.userData.skyDome.position.copy(chaseCamera.camera.position);
    }
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
    if (Math.abs(a.travelDist - b.travelDist) > CAR_LENGTH * 1.5) return;
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

    const places = finishOrder.length > 0 ? finishOrder : [
      { label: 'Вы', dist: playerTravelDist },
      ...aiCars.map((ai, i) => ({
        label: `Бот ${i + 1}`,
        dist: ai.travelDist
      })),
    ].sort((a, b) => b.dist - a.dist);

    console.log('[FINISH] Final standings:', places.map((p, i) => `${i+1}. ${p.label} (${p.dist.toFixed(1)})`).join(', '));

    if (places[0].label === 'Вы' || places[0].label === 'You') {
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
    lastTime = 0; // Reset to avoid huge dt after pause
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

  function highlightMobileControls() {
    const leftWrapper = document.querySelector('.button-controls-wrapper__left');
    const rightWrapper = document.querySelector('.button-controls-wrapper__right');
    if (leftWrapper) {
      leftWrapper.classList.remove('controls-pulse-green');
      void leftWrapper.offsetWidth;
      leftWrapper.classList.add('controls-pulse-green');
    }
    if (rightWrapper) {
      rightWrapper.classList.remove('controls-pulse-green');
      void rightWrapper.offsetWidth;
      rightWrapper.classList.add('controls-pulse-green');
    }
    setTimeout(() => {
      if (leftWrapper) leftWrapper.classList.remove('controls-pulse-green');
      if (rightWrapper) rightWrapper.classList.remove('controls-pulse-green');
    }, 3500);
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
    finishOrder = [];
    playerFinished = false;
    finishCountdown = -1;
    lastTime = 0;
    playerSlowDownFrames = 0;
    playerBoostDelta = 0;
    dangerBoostPhase = null;
    dangerBlinkTimer = 0;
    coinDoubleUsed = false;
    if (gameScoreValue) gameScoreValue.innerText = '0';

    baseSpeed = 0.1875 * playerCarClass.modifier;
    playerMoveSpeed = 0.15 * playerCarClass.modifier;

    // Pick a random skybox for each new race start!
    setRandomSkybox(scene);

    // Pulse green on mobile control buttons at race start
    highlightMobileControls();

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
    finishLineMesh.position.z = -200; // offscreen until race nears end
    finishLineMesh.visible = false;

    // AI Cars - Line up side-by-side with player on start line (relZ = 0)
    aiCars.forEach(ai => scene.remove(ai.mesh));
    aiCars.length = 0;

    const aiModels = ['models/cars/police.glb', 'models/cars/race-future.glb'];
    const aiCarColors = [getCarMaterial('car_race_red'), getCarMaterial('car_race_black')];

    for (let i = 0; i < 2; i++) {
      const aiMesh = createCarFromGLTF(aiModels[i], aiCarColors[i]);
      scene.add(aiMesh);
      const ai = new AiCar3D(aiMesh, i, level, baseSpeed);
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
