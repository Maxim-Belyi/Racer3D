import * as THREE from 'three';

/**
 * Chase camera that follows the player car from behind and above.
 */
export class ChaseCamera {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 300);
    this.offset = new THREE.Vector3(0, 8, 14); // behind and above
    this.lookAheadZ = -12; // look ahead of player
    this.lerpSpeed = 0.08;
    this._target = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();

    // Initial position
    this.camera.position.set(0, 8, 14);
    this.camera.lookAt(0, 0, -12);
  }

  /** Update camera to follow playerPosition (Vector3). */
  update(playerPos) {
    // Desired camera position: behind and above the player
    this._target.set(
      playerPos.x * 0.3, // subtle X follow
      playerPos.y + this.offset.y,
      playerPos.z + this.offset.z
    );

    // Smooth lerp
    this.camera.position.lerp(this._target, this.lerpSpeed);

    // Look at a point ahead of the player
    this._lookAt.set(
      playerPos.x * 0.5,
      playerPos.y + 1,
      playerPos.z + this.lookAheadZ
    );
    this.camera.lookAt(this._lookAt);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
