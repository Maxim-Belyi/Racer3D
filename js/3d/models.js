import * as THREE from 'three';

// ── Shared materials (reused across instances) ──────────────────────────────

const MAT = {
  // Car body colors (keyed by catalog class)
  carBlue:    new THREE.MeshStandardMaterial({ color: 0x4488ff, metalness: 0.3, roughness: 0.5 }),
  carRed:     new THREE.MeshStandardMaterial({ color: 0xdd3333, metalness: 0.3, roughness: 0.5 }),
  carBlack:   new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5, roughness: 0.4 }),
  carGold:    new THREE.MeshStandardMaterial({ color: 0xffaa00, metalness: 0.6, roughness: 0.3 }),
  carSilver:  new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.7, roughness: 0.3 }),
  carGreen:   new THREE.MeshStandardMaterial({ color: 0x33aa44, metalness: 0.3, roughness: 0.5 }),
  carYellow:  new THREE.MeshStandardMaterial({ color: 0xffdd00, metalness: 0.4, roughness: 0.4 }),
  carOrange:  new THREE.MeshStandardMaterial({ color: 0xff7700, metalness: 0.3, roughness: 0.5 }),
  carWhite:   new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.3, roughness: 0.5 }),

  cabin:      new THREE.MeshStandardMaterial({ color: 0x88ccff, metalness: 0.1, roughness: 0.2, transparent: true, opacity: 0.6 }),
  wheel:      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
  wheelRim:   new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 }),

  // Environment
  trunkBrown: new THREE.MeshLambertMaterial({ color: 0x8B5A2B }),
  leafGreen1: new THREE.MeshLambertMaterial({ color: 0x2d8c3c }),
  leafGreen2: new THREE.MeshLambertMaterial({ color: 0x5aad3a }),
  leafGreen3: new THREE.MeshLambertMaterial({ color: 0x1e7a2e }),
  leafYellow: new THREE.MeshLambertMaterial({ color: 0xaacc33 }),

  // Items
  coinGold:   new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.2, emissive: 0x665500, emissiveIntensity: 0.3 }),
  boostGreen: new THREE.MeshStandardMaterial({ color: 0x00ff88, metalness: 0.4, roughness: 0.3, emissive: 0x00aa44, emissiveIntensity: 0.5 }),
  dangerRed:  new THREE.MeshStandardMaterial({ color: 0xff2222, metalness: 0.2, roughness: 0.5, emissive: 0xaa0000, emissiveIntensity: 0.4 }),
  magnetGrey: new THREE.MeshStandardMaterial({ color: 0x8888aa, metalness: 0.9, roughness: 0.2 }),
  magnetRed:  new THREE.MeshStandardMaterial({ color: 0xff0000, metalness: 0.6, roughness: 0.3 }),
  magnetBlue: new THREE.MeshStandardMaterial({ color: 0x0000ff, metalness: 0.6, roughness: 0.3 }),
  crackDark:  new THREE.MeshLambertMaterial({ color: 0x333333, transparent: true, opacity: 0.7 }),

  // Finish / start
  checkerW:   new THREE.MeshLambertMaterial({ color: 0xffffff }),
  checkerB:   new THREE.MeshLambertMaterial({ color: 0x111111 }),
};

// Car ID → body material map
const CAR_MATERIAL_MAP = {
  'default':            MAT.carBlue,
  'car_porse_gold':     MAT.carGold,
  'car_porshe_black2':  MAT.carBlack,
  'car_porshe_silver':  MAT.carSilver,
  'car_race_red':       MAT.carRed,
  'car_race_blue':      MAT.carBlue,
  'car_race_green':     MAT.carGreen,
  'car_race_yellow':    MAT.carYellow,
  'car_race_orange':    MAT.carOrange,
  'car_race_black':     MAT.carBlack,
  'car_sport_black':    MAT.carBlack,
  'car_sport_gold':     MAT.carGold,
  'car_sport_silver':   MAT.carSilver,
};

export function createCar(bodyMaterial) {
  const group = new THREE.Group();

  // Body (lower)
  const bodyGeo = new THREE.BoxGeometry(1.6, 0.5, 3.2);
  const body = new THREE.Mesh(bodyGeo, bodyMaterial || MAT.carBlue);
  body.position.y = 0.35;
  body.castShadow = true;
  group.add(body);

  // Cabin (upper, smaller, transparent windows)
  const cabinGeo = new THREE.BoxGeometry(1.3, 0.45, 1.5);
  const cabin = new THREE.Mesh(cabinGeo, MAT.cabin);
  cabin.position.y = 0.82;
  cabin.position.z = 0.1;
  cabin.castShadow = true;
  group.add(cabin);

  // Wheels (4 cylinders)
  const wheelGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.2, 8);
  const wheelPositions = [
    [-0.8, 0.15, -1.0],
    [ 0.8, 0.15, -1.0],
    [-0.8, 0.15,  1.0],
    [ 0.8, 0.15,  1.0],
  ];
  wheelPositions.forEach(([x, y, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, MAT.wheel);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, z);
    wheel.castShadow = true;
    group.add(wheel);
  });

  group.userData.bodyMesh = body;
  group.userData.type = 'car';

  return group;
}

export function getCarMaterial(carId) {
  return CAR_MATERIAL_MAP[carId] || MAT.carBlue;
}

export function setCarColor(carGroup, carId) {
  const mat = getCarMaterial(carId);
  if (carGroup.userData.bodyMesh) {
    carGroup.userData.bodyMesh.material = mat;
  }
}

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const gltfLoader = new GLTFLoader();
const modelCache = new Map();

/**
 * Creates a car Group. If glbUrl is provided, loads GLB model into the group.
 * Uses procedural box car as fallback until loaded or if glbUrl is missing.
 */
export function createCarFromGLTF(glbUrl, fallbackMaterial) {
  const group = new THREE.Group();
  group.userData.type = 'car';

  const fallback = createCar(fallbackMaterial);
  group.add(fallback);
  group.userData.bodyMesh = fallback.userData.bodyMesh;
  group.userData.currentChild = fallback;

  if (glbUrl) {
    loadAndApplyModel(group, glbUrl);
  }

  return group;
}

export function updateCarMesh(group, glbUrl, fallbackMaterial) {
  if (group.userData.currentChild) {
    group.remove(group.userData.currentChild);
  }

  const fallback = createCar(fallbackMaterial);
  group.add(fallback);
  group.userData.bodyMesh = fallback.userData.bodyMesh;
  group.userData.currentChild = fallback;

  if (glbUrl) {
    loadAndApplyModel(group, glbUrl);
  }
}

function loadAndApplyModel(group, glbUrl) {
  if (modelCache.has(glbUrl)) {
    const cached = modelCache.get(glbUrl).clone();
    if (group.userData.currentChild) group.remove(group.userData.currentChild);
    group.add(cached);
    group.userData.currentChild = cached;
    group.userData.bodyMesh = null;
    return;
  }

  gltfLoader.load(
    glbUrl,
    (gltf) => {
      const model = gltf.scene;
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Normalize scale & pivot to standard car size (~1.6 x 3.2)
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);

      const targetLength = 3.2;
      const scale = targetLength / (size.z || 1);
      model.scale.set(scale, scale, scale);

      // Center model bottom at ground level (y = 0)
      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

      // Rotate 180 degrees so car faces forward down the road (-Z)
      model.rotation.y = Math.PI;

      modelCache.set(glbUrl, model);

      const instance = model.clone();
      if (group.userData.currentChild) group.remove(group.userData.currentChild);
      group.add(instance);
      group.userData.currentChild = instance;
      group.userData.bodyMesh = null;
    },
    undefined,
    (err) => {
      console.warn(`[GLTFLoader] Failed to load ${glbUrl}, keeping fallback:`, err);
    }
  );
}

function loadAndApplyEnvModel(group, glbUrl, targetHeight = 2.5, customMaterial = null) {
  if (modelCache.has(glbUrl)) {
    const cached = modelCache.get(glbUrl).clone();
    if (group.userData.fallbackMesh) {
      group.remove(group.userData.fallbackMesh);
      group.userData.fallbackMesh = null;
    }
    group.add(cached);
    return;
  }

  gltfLoader.load(
    glbUrl,
    (gltf) => {
      const model = gltf.scene;
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (customMaterial) {
            child.material = customMaterial;
          }
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);

      const scale = targetHeight / (size.y || 1);
      model.scale.set(scale, scale, scale);

      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

      modelCache.set(glbUrl, model);

      const instance = model.clone();
      if (group.userData.fallbackMesh) {
        group.remove(group.userData.fallbackMesh);
        group.userData.fallbackMesh = null;
      }
      group.add(instance);
    },
    undefined,
    (err) => {
      console.warn(`[GLTFLoader] Failed env model ${glbUrl}:`, err);
    }
  );
}

// ── Trees ───────────────────────────────────────────────────────────────────

const treeVariations = [
  { trunkH: 1.5, crownType: 'cone',   crownH: 2.5, crownR: 1.2, leaf: MAT.leafGreen1 },
  { trunkH: 2.0, crownType: 'sphere', crownH: 2.0, crownR: 1.5, leaf: MAT.leafGreen2 },
  { trunkH: 1.2, crownType: 'cone',   crownH: 3.0, crownR: 1.0, leaf: MAT.leafGreen3 },
  { trunkH: 1.8, crownType: 'dodeca', crownH: 2.2, crownR: 1.3, leaf: MAT.leafYellow },
];

const glbTrees = [
  'models/env/tree.glb',
  'models/env/tree-autumn.glb',
  'models/env/tree-tall.glb',
  'models/env/tree-autumn-tall.glb',
];

export function createTree(variationIndex) {
  const v = treeVariations[variationIndex % treeVariations.length];
  const group = new THREE.Group();
  group.userData.type = 'tree';

  // Trunk
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, v.trunkH, 6);
  const trunk = new THREE.Mesh(trunkGeo, MAT.trunkBrown);
  trunk.position.y = v.trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);

  // Crown
  let crownGeo;
  if (v.crownType === 'cone') {
    crownGeo = new THREE.ConeGeometry(v.crownR, v.crownH, 6);
  } else if (v.crownType === 'sphere') {
    crownGeo = new THREE.SphereGeometry(v.crownR, 6, 5);
  } else {
    crownGeo = new THREE.DodecahedronGeometry(v.crownR, 0);
  }
  const crown = new THREE.Mesh(crownGeo, v.leaf);
  crown.position.y = v.trunkH + v.crownH / 2 - 0.3;
  crown.castShadow = true;
  group.add(crown);

  group.userData.fallbackMesh = trunk;

  const glbUrl = glbTrees[variationIndex % glbTrees.length];
  loadAndApplyEnvModel(group, glbUrl, 3.8);

  return group;
}

// ── Roadside Props (Survival Kit & Platformer items) ─────────────────────────

const sidePropModels = [
  { url: 'models/survival/barrel.glb', height: 1.2 },
  { url: 'models/survival/box.glb', height: 1.0 },
  { url: 'models/survival/resource-planks.glb', height: 0.8 },
  { url: 'models/survival/rock-sand-a.glb', height: 1.5 },
  { url: 'models/survival/rock-sand-b.glb', height: 1.8 },
  { url: 'models/survival/rock-sand-c.glb', height: 1.3 },
  { url: 'models/survival/signpost.glb', height: 2.2 },
  { url: 'models/survival/signpost-single.glb', height: 2.0 },
  { url: 'models/survival/tent-canvas.glb', height: 1.6 },
  { url: 'models/survival/tree-log-small.glb', height: 0.8 },
  { url: 'models/platformer/flowers.glb', height: 0.9 },
  { url: 'models/platformer/flowers-tall.glb', height: 1.4 },
  { url: 'models/platformer/mushrooms.glb', height: 0.8 },
  { url: 'models/platformer/rocks.glb', height: 0.6 },
];

export function createSideProp(index) {
  const group = new THREE.Group();
  group.userData.type = 'sideProp';

  const prop = sidePropModels[index % sidePropModels.length];
  loadAndApplyEnvModel(group, prop.url, prop.height);

  return group;
}

// ── Coin ────────────────────────────────────────────────────────────────────

const brightGoldMaterial = new THREE.MeshStandardMaterial({
  color: 0xffea00, // Bright arcade cartoon gold
  emissive: 0xffa700,
  emissiveIntensity: 0.45,
  roughness: 0.2,
  metalness: 0.2,
});

export function createCoin() {
  const group = new THREE.Group();
  group.userData.type = 'coin';

  // Main disc fallback
  const geo = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16);
  const mesh = new THREE.Mesh(geo, brightGoldMaterial);
  mesh.castShadow = true;
  group.add(mesh);

  group.userData.fallbackMesh = mesh;
  group.userData.innerMesh = mesh;

  loadAndApplyEnvModel(group, 'models/items/coin.glb', 0.8, brightGoldMaterial);

  return group;
}

// ── Boost Arrow ─────────────────────────────────────────────────────────────

const arrowMaterial = new THREE.MeshStandardMaterial({
  color: 0x00f0ff,
  emissive: 0x00a0ff,
  emissiveIntensity: 0.7,
  metalness: 0.4,
  roughness: 0.2,
});

export function createBoostArrow() {
  const group = new THREE.Group();
  group.userData.type = 'boost';

  // Arrow body fallback
  const coneGeo = new THREE.ConeGeometry(0.25, 0.5, 4);
  const cone = new THREE.Mesh(coneGeo, arrowMaterial);
  cone.position.y = 0.3;
  cone.castShadow = true;
  group.add(cone);

  group.userData.fallbackMesh = cone;

  loadAndApplyEnvModel(group, 'models/items/arrow.glb', 0.5, arrowMaterial);

  return group;
}

// ── Danger (Traffic Cone GLB) ───────────────────────────────────────────────

export function createDanger() {
  const group = new THREE.Group();
  group.userData.type = 'danger';

  const coneGeo = new THREE.ConeGeometry(0.5, 1.2, 8);
  const fallbackMesh = new THREE.Mesh(coneGeo, MAT.dangerRed);
  fallbackMesh.position.y = 0.6;
  fallbackMesh.castShadow = true;
  group.add(fallbackMesh);

  group.userData.fallbackMesh = fallbackMesh;
  group.userData.innerMesh = fallbackMesh;

  loadAndApplyEnvModel(group, 'models/env/cone.glb', 1.4);

  return group;
}

// ── Magnet ──────────────────────────────────────────────────────────────────

export function createMagnet() {
  const group = new THREE.Group();
  group.userData.type = 'magnet';

  const magnetGroup = new THREE.Group();

  // Horseshoe U-arch (Red)
  const archGeo = new THREE.TorusGeometry(0.35, 0.1, 16, 24, Math.PI);
  const redMat = new THREE.MeshStandardMaterial({
    color: 0xee2222,
    metalness: 0.5,
    roughness: 0.3,
    emissive: 0x550000,
    emissiveIntensity: 0.2,
  });
  const arch = new THREE.Mesh(archGeo, redMat);
  arch.rotation.x = Math.PI / 2;
  arch.castShadow = true;
  magnetGroup.add(arch);

  // Silver tips at the ends of the U-magnet
  const silverMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.9, roughness: 0.2 });
  const tipGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.18, 16);

  const leftTip = new THREE.Mesh(tipGeo, silverMat);
  leftTip.position.set(-0.35, 0, -0.09);
  leftTip.rotation.x = Math.PI / 2;
  leftTip.castShadow = true;
  magnetGroup.add(leftTip);

  const rightTip = new THREE.Mesh(tipGeo, silverMat);
  rightTip.position.set(0.35, 0, -0.09);
  rightTip.rotation.x = Math.PI / 2;
  rightTip.castShadow = true;
  magnetGroup.add(rightTip);

  magnetGroup.position.y = 0.5;
  group.add(magnetGroup);

  group.userData.fallbackMesh = magnetGroup;
  group.userData.innerMesh = magnetGroup;

  return group;
}

// ── Stones Obstacle (replaces old crack) ─────────────────────────────────────

export function createCrack() {
  const group = new THREE.Group();
  group.userData.type = 'crack';

  const geo = new THREE.DodecahedronGeometry(0.5, 0);
  const mesh = new THREE.Mesh(geo, MAT.crackDark);
  mesh.position.y = 0.25;
  mesh.castShadow = true;
  group.add(mesh);

  group.userData.fallbackMesh = mesh;
  group.userData.innerMesh = mesh;

  loadAndApplyEnvModel(group, 'models/platformer/stones.glb', 0.1);

  return group;
}

// ── Start & Finish Lines (PNG Textures) ──────────────────────────────────────

const textureLoader = new THREE.TextureLoader();

const startTexture = textureLoader.load('images/decorations/start.png');
startTexture.colorSpace = THREE.SRGBColorSpace;
const startMaterial = new THREE.MeshBasicMaterial({
  map: startTexture,
  transparent: true,
  side: THREE.DoubleSide
});

const finishTexture = textureLoader.load('images/decorations/finish.png');
finishTexture.colorSpace = THREE.SRGBColorSpace;
const finishMaterial = new THREE.MeshBasicMaterial({
  map: finishTexture,
  transparent: true,
  side: THREE.DoubleSide
});

export function createStartLine(width = 8) {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(width, 2.5);
  const mesh = new THREE.Mesh(geo, startMaterial);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  group.add(mesh);
  group.userData.type = 'startLine';
  return group;
}

export function createFinishLine(width = 8) {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(width, 2.5);
  const mesh = new THREE.Mesh(geo, finishMaterial);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  group.add(mesh);
  group.userData.type = 'finishLine';
  return group;
}

export function createCheckerLine(width) {
  return createFinishLine(width);
}
