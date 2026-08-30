import * as THREE from 'three';

export const ROAD_WIDTH = 10;       // total road width in world units
export const ROAD_HALF  = ROAD_WIDTH / 2;
const SEGMENT_LENGTH    = 40;       // length of one road segment
const SEGMENTS_AHEAD    = 6;        // segments visible ahead
const SEGMENTS_BEHIND   = 2;        // segments kept behind player

const MARKING_GAP       = 1.5;      // gap between dashes
const MARKING_LEN       = 2.0;      // dash length
const MARKING_W         = 0.15;     // dash width

/**
 * Creates the infinite-scrolling road system.
 * Returns an object with an update(playerZ) method.
 */
export function createRoad(scene) {
  // Road surface material
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x555555 });

  // Shoulder materials (slightly different shade)
  const shoulderMat = new THREE.MeshLambertMaterial({ color: 0x444444 });

  // Center line dash material
  const dashMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

  // Pool of road segments
  const segments = [];
  const dashPool = [];

  // Shoulder strips (edge lines)
  const edgeMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee });

  function createSegment(z) {
    const group = new THREE.Group();

    // Road surface
    const roadGeo = new THREE.PlaneGeometry(ROAD_WIDTH, SEGMENT_LENGTH);
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, z);
    road.receiveShadow = true;
    group.add(road);

    // Left edge line
    const edgeGeo = new THREE.PlaneGeometry(0.12, SEGMENT_LENGTH);
    const edgeL = new THREE.Mesh(edgeGeo, edgeMat);
    edgeL.rotation.x = -Math.PI / 2;
    edgeL.position.set(-ROAD_HALF + 0.06, 0.005, z);
    group.add(edgeL);

    // Right edge line
    const edgeR = new THREE.Mesh(edgeGeo, edgeMat);
    edgeR.rotation.x = -Math.PI / 2;
    edgeR.position.set(ROAD_HALF - 0.06, 0.005, z);
    group.add(edgeR);

    // Center dashes
    const dashGeo = new THREE.PlaneGeometry(MARKING_W, MARKING_LEN);
    const segStart = z - SEGMENT_LENGTH / 2;
    const segEnd   = z + SEGMENT_LENGTH / 2;
    for (let dz = segStart; dz < segEnd; dz += MARKING_LEN + MARKING_GAP) {
      const dash = new THREE.Mesh(dashGeo, dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(0, 0.005, dz + MARKING_LEN / 2);
      group.add(dash);
    }

    group.userData.zCenter = z;
    scene.add(group);
    segments.push(group);
    return group;
  }

  // Initial segments
  for (let i = -SEGMENTS_BEHIND; i < SEGMENTS_AHEAD; i++) {
    createSegment(i * SEGMENT_LENGTH);
  }

  /** Call every frame with the player's current Z position. */
  function update(playerZ) {
    // Check if we need to recycle segments
    for (const seg of segments) {
      const dist = seg.userData.zCenter - playerZ;
      // If segment is too far behind, move it ahead
      if (dist > SEGMENTS_BEHIND * SEGMENT_LENGTH) {
        const furthestAhead = Math.min(...segments.map(s => s.userData.zCenter));
        seg.userData.zCenter = furthestAhead - SEGMENT_LENGTH;
        // Reposition all children
        const offset = seg.userData.zCenter - seg.children[0].position.z;
        seg.children.forEach(child => {
          child.position.z += offset;
        });
        // Actually, simpler: just reposition the group
        // But since children have absolute positions, let's just recreate
      }
    }

    // Simpler approach: just check frontmost and backmost
    segments.sort((a, b) => a.userData.zCenter - b.userData.zCenter);

    // Add new segments ahead
    const frontZ = segments[0].userData.zCenter;
    if (playerZ - frontZ < SEGMENTS_AHEAD * SEGMENT_LENGTH) {
      // Still fine
    }
    while (playerZ - segments[0].userData.zCenter > (SEGMENTS_AHEAD - 1) * SEGMENT_LENGTH) {
      // Need more ahead (player moved forward = negative Z)
      break; // guard
    }

    // Recycle: move backmost segment to front if player has moved far enough
    const backSeg = segments[segments.length - 1];
    const frontSeg = segments[0];

    if (backSeg.userData.zCenter - playerZ > SEGMENTS_BEHIND * SEGMENT_LENGTH) {
      // Move this segment to the front
      const newZ = frontSeg.userData.zCenter - SEGMENT_LENGTH;
      const dz = newZ - backSeg.userData.zCenter;
      backSeg.children.forEach(child => { child.position.z += dz; });
      backSeg.userData.zCenter = newZ;
    }

    // Also check if we need one more in front
    if (playerZ - frontSeg.userData.zCenter < -10) {
      // Player is ahead of frontmost segment, add one
      const newZ = frontSeg.userData.zCenter - SEGMENT_LENGTH;
      // Recycle from back
      const recycleSeg = segments[segments.length - 1];
      const dz = newZ - recycleSeg.userData.zCenter;
      recycleSeg.children.forEach(child => { child.position.z += dz; });
      recycleSeg.userData.zCenter = newZ;
    }
  }

  return { update, ROAD_WIDTH, ROAD_HALF };
}
