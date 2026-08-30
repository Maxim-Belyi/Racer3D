import * as THREE from 'three';

const SKYBOX_LIST = [
  'models/skybox/skybox-day.png',
  'models/skybox/skybox-morning.png',
  'models/skybox/skybox-night.png',
  'models/skybox/skybox-alien.png',
  'models/skybox/skybox-space.png',
];

const skyboxCache = new Map();
const textureLoader = new THREE.TextureLoader();

export function setRandomSkybox(scene) {
  const skyUrl = SKYBOX_LIST[Math.floor(Math.random() * SKYBOX_LIST.length)];

  if (skyboxCache.has(skyUrl)) {
    scene.background = skyboxCache.get(skyUrl);
    return;
  }

  textureLoader.load(skyUrl, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    skyboxCache.set(skyUrl, texture);
    scene.background = texture;
  });
}

/**
 * Sets up the Three.js scene, renderer, lighting, and ground.
 */
export function createScene(container) {
  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.appendChild(renderer.domElement);

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB); // Fallback color while loading
  scene.fog = new THREE.Fog(0xbce0fd, 250, 750);

  // Load a random skybox on scene initialization
  setRandomSkybox(scene);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
  sunLight.position.set(30, 50, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 200;
  sunLight.shadow.camera.left = -40;
  sunLight.shadow.camera.right = 40;
  sunLight.shadow.camera.top = 40;
  sunLight.shadow.camera.bottom = -40;
  scene.add(sunLight);

  // Ground plane
  const groundGeo = new THREE.PlaneGeometry(400, 600);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x4a8c3f });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  // Handle resize
  function onResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  return { renderer, scene, sunLight, ground };
}
