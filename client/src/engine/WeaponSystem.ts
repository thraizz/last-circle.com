import * as THREE from 'three';
import { ShotInfo, Weapon, WeaponState, WeaponStats, WeaponType } from '../types/weapons';

export class WeaponSystem {
  private currentWeapon: Weapon | null;
  private weaponState: WeaponState;
  private camera: THREE.PerspectiveCamera;
  private onShoot: (shot: ShotInfo) => void;

  // Reusable vectors for performance
  private static readonly FORWARD = new THREE.Vector3(0, 0, -1);
  private static readonly tempVector = new THREE.Vector3();
  private static readonly tempDirection = new THREE.Vector3();
  private static readonly tempQuaternion = new THREE.Quaternion();
  private static readonly xAxis = new THREE.Vector3(1, 0, 0);
  private static readonly yAxis = new THREE.Vector3(0, 1, 0);

  // Weapon definitions with balanced stats for competitive play
  private static readonly WEAPONS: Record<WeaponType, WeaponStats> = {
    RIFLE: {
      damage: 25,
      fireRate: 8,
      magazineSize: 30,
      reloadTime: 2.5,
      accuracy: 0.8,
      movementAccuracyPenalty: 0.2,
      recoilPattern: [
        new THREE.Vector3(0.005, 0.01, 0),
        new THREE.Vector3(0.01, 0.015, 0),
        new THREE.Vector3(0.015, 0.02, 0),
        new THREE.Vector3(0.02, 0.025, 0),
        new THREE.Vector3(0.01, 0.02, 0),
      ],
      recoilRecoverySpeed: 0.9,
      range: 100,
      bulletSpeed: 400,
    },
    SMG: {
      damage: 15,
      fireRate: 12,
      magazineSize: 25,
      reloadTime: 1.8,
      accuracy: 0.7,
      movementAccuracyPenalty: 0.1,
      recoilPattern: [
        new THREE.Vector3(0.003, 0.006, 0),
        new THREE.Vector3(0.005, 0.01, 0),
        new THREE.Vector3(0.008, 0.012, 0),
        new THREE.Vector3(0.01, 0.015, 0),
      ],
      recoilRecoverySpeed: 1.2,
      range: 50,
      bulletSpeed: 350,
    },
    PISTOL: {
      damage: 20,
      fireRate: 5,
      magazineSize: 12,
      reloadTime: 1.5,
      accuracy: 0.85,
      movementAccuracyPenalty: 0.1,
      recoilPattern: [
        new THREE.Vector3(0.01, 0.02, 0),
        new THREE.Vector3(0.02, 0.03, 0),
      ],
      recoilRecoverySpeed: 1.0,
      range: 40,
      bulletSpeed: 300,
    },
    SNIPER: {
      damage: 100,
      fireRate: 1,
      magazineSize: 5,
      reloadTime: 3,
      accuracy: 0.95,
      movementAccuracyPenalty: 0.4,
      recoilPattern: [
        new THREE.Vector3(0.02, 0.03, 0),
        new THREE.Vector3(0.03, 0.04, 0),
      ],
      recoilRecoverySpeed: 0.8,
      range: 200,
      bulletSpeed: 500,
    },
  };

  private reloadTimeout: number | null = null;
  private isMoving: boolean = false;
  private weaponMesh: THREE.Mesh | null = null;
  private magazineMesh: THREE.Mesh | null = null;
  private reloadAnimationStartTime: number | null = null;
  private cameraJerkEffect: THREE.Vector3 | null = null;
  private cameraJerkDecay: number = 15; // How fast the jerk effect decays
  private static readonly particleGeometry = new THREE.SphereGeometry(0.02, 4, 4);
  private static readonly particleMaterial = new THREE.MeshBasicMaterial({
    color: 0xaaddff,
    transparent: true,
    opacity: 0.8
  });
  private lastInsertEffectTime: number = 0;
  // Pool of particle objects for reuse
  private particlePool: THREE.Mesh[] = [];

  constructor(camera: THREE.PerspectiveCamera, onShoot: (shot: ShotInfo) => void) {
    this.camera = camera;
    this.onShoot = onShoot;
    this.currentWeapon = null;
    this.weaponState = {
      currentRecoil: new THREE.Vector3(),
      isAiming: false,
      currentAccuracy: 1.0,
    };
    
    // Create particle pool - pre-allocate objects
    for (let i = 0; i < 3; i++) {
      const particle = new THREE.Mesh(
        WeaponSystem.particleGeometry, 
        WeaponSystem.particleMaterial.clone()
      );
      particle.visible = false;
      this.particlePool.push(particle);
    }
  }

  public equipWeapon(type: WeaponType, name: string): void {
    if (this.reloadTimeout !== null) {
      window.clearTimeout(this.reloadTimeout);
      this.reloadTimeout = null;
    }

    const stats = WeaponSystem.WEAPONS[type];
    if (!stats) return;

    this.currentWeapon = {
      type,
      name,
      stats,
      currentAmmo: stats.magazineSize,
      totalAmmo: stats.magazineSize * 3,
      isReloading: false,
      lastShotTime: 0,
    };

    // Reset weapon state
    this.weaponState.currentRecoil.set(0, 0, 0);
    this.weaponState.currentAccuracy = stats.accuracy;

    // Create or update weapon model
    this.createWeaponModel(type);
  }

  private createWeaponModel(type: WeaponType): void {
    // Remove existing weapon model if any
    if (this.weaponMesh && this.weaponMesh.parent) {
      this.weaponMesh.parent.remove(this.weaponMesh);
    }

    // Create new weapon model based on type
    // This is a simplified representation
    let geometry: THREE.BufferGeometry;
    let material: THREE.Material;
    let position: THREE.Vector3;
    let scale: THREE.Vector3;
    let magazineGeometry: THREE.BufferGeometry;
    let magazinePosition: THREE.Vector3;

    switch (type) {
      case 'RIFLE':
        geometry = new THREE.BoxGeometry(0.1, 0.1, 0.8);
        material = new THREE.MeshStandardMaterial({ color: 0x444444 });
        position = new THREE.Vector3(0.3, -0.3, -0.8);
        scale = new THREE.Vector3(1, 1, 1);
        magazineGeometry = new THREE.BoxGeometry(0.1, 0.15, 0.1);
        magazinePosition = new THREE.Vector3(0, -0.1, 0.1);
        break;
      case 'SMG':
        geometry = new THREE.BoxGeometry(0.1, 0.1, 0.6);
        material = new THREE.MeshStandardMaterial({ color: 0x222222 });
        position = new THREE.Vector3(0.25, -0.25, -0.7);
        scale = new THREE.Vector3(1.2, 1, 1);
        magazineGeometry = new THREE.BoxGeometry(0.08, 0.12, 0.08);
        magazinePosition = new THREE.Vector3(0, -0.1, 0.05);
        break;
      case 'PISTOL':
        geometry = new THREE.BoxGeometry(0.07, 0.15, 0.3);
        material = new THREE.MeshStandardMaterial({ color: 0x333333 });
        position = new THREE.Vector3(0.2, -0.2, -0.5);
        scale = new THREE.Vector3(1, 1, 1);
        magazineGeometry = new THREE.BoxGeometry(0.06, 0.1, 0.06);
        magazinePosition = new THREE.Vector3(0, -0.1, 0);
        break;
      case 'SNIPER':
        geometry = new THREE.BoxGeometry(0.08, 0.08, 1.2);
        material = new THREE.MeshStandardMaterial({ color: 0x555555 });
        position = new THREE.Vector3(0.3, -0.3, -1);
        scale = new THREE.Vector3(1, 1, 1);
        magazineGeometry = new THREE.BoxGeometry(0.1, 0.16, 0.1);
        magazinePosition = new THREE.Vector3(0, -0.1, 0.2);
        break;
    }

    this.weaponMesh = new THREE.Mesh(geometry, material);
    this.weaponMesh.position.copy(position);
    this.weaponMesh.scale.copy(scale);
    
    // Create magazine
    const magazineMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
    this.magazineMesh = new THREE.Mesh(magazineGeometry, magazineMaterial);
    this.magazineMesh.position.copy(magazinePosition);
    this.weaponMesh.add(this.magazineMesh);
    
    // Add to camera to make it follow view
    this.camera.add(this.weaponMesh);
  }

  public startReload(): boolean {
    if (!this.currentWeapon || 
        this.currentWeapon.isReloading || 
        this.currentWeapon.currentAmmo === this.currentWeapon.stats.magazineSize ||
        this.currentWeapon.totalAmmo <= 0) {
      return false;
    }

    this.currentWeapon.isReloading = true;
    this.reloadAnimationStartTime = performance.now();
    this.reloadTimeout = window.setTimeout(
      () => this.completeReload(),
      this.currentWeapon.stats.reloadTime * 1000
    );
    
    // Add start reload camera jerk effect
    this.applyCameraJerkEffect(0.02, 0.01);
    
    return true;
  }

  private completeReload(): void {
    if (!this.currentWeapon) return;

    const ammoNeeded = this.currentWeapon.stats.magazineSize - this.currentWeapon.currentAmmo;
    const ammoAvailable = Math.min(ammoNeeded, this.currentWeapon.totalAmmo);

    this.currentWeapon.currentAmmo += ammoAvailable;
    this.currentWeapon.totalAmmo -= ammoAvailable;
    this.currentWeapon.isReloading = false;
    this.reloadTimeout = null;
    this.reloadAnimationStartTime = null;
    
    // Add completion reload camera jerk effect
    this.applyCameraJerkEffect(0.015, 0.02);
  }

  // Apply a quick jerk effect to the camera - optimized
  private applyCameraJerkEffect(x: number, y: number): void {
    // Less intense jerk effect to reduce visual impact and performance cost
    const randomX = (Math.random() - 0.5) * 2 * x * 0.8;
    const randomY = -Math.abs(y) * 0.8;
    
    this.cameraJerkEffect = new THREE.Vector3(randomX, randomY, 0);
    
    // Apply initial jerk directly without extra operations
    this.camera.rotation.x += this.cameraJerkEffect.y;
    this.camera.rotation.y += this.cameraJerkEffect.x;
  }

  public shoot(): boolean {
    if (!this.currentWeapon || 
        this.currentWeapon.isReloading || 
        this.currentWeapon.currentAmmo <= 0) {
      return false;
    }

    const now = performance.now();
    const timeSinceLastShot = (now - this.currentWeapon.lastShotTime) / 1000;
    if (timeSinceLastShot < 1 / this.currentWeapon.stats.fireRate) {
      return false;
    }

    // Apply recoil using reusable vector
    const recoilIndex = Math.min(
      this.currentWeapon.stats.recoilPattern.length - 1,
      this.currentWeapon.stats.magazineSize - this.currentWeapon.currentAmmo
    );
    const recoil = this.currentWeapon.stats.recoilPattern[recoilIndex];
    
    // Apply recoil with more visual effect but less impact on actual aim
    // Use a fraction of the recoil for actual aiming, full amount for visual
    const visualRecoil = recoil.clone();
    const aimRecoil = recoil.clone().multiplyScalar(0.4); // Only 40% of recoil affects actual aim
    
    // Track the actual aim impact separately
    this.weaponState.currentRecoil.add(aimRecoil);

    // Apply visual recoil to camera using quaternions
    WeaponSystem.tempQuaternion.setFromAxisAngle(WeaponSystem.xAxis, visualRecoil.y);
    this.camera.quaternion.multiply(WeaponSystem.tempQuaternion);
    
    WeaponSystem.tempQuaternion.setFromAxisAngle(WeaponSystem.yAxis, visualRecoil.x);
    this.camera.quaternion.multiply(WeaponSystem.tempQuaternion);
    
    // Update Euler angles to match quaternion
    this.camera.rotation.setFromQuaternion(this.camera.quaternion);

    // Calculate accuracy with movement penalty
    const movementPenalty = this.isMoving ? this.currentWeapon.stats.movementAccuracyPenalty : 0;
    const aimingBonus = this.weaponState.isAiming ? 0.15 : 0;
    this.weaponState.currentAccuracy = Math.max(
      0.1,
      this.currentWeapon.stats.accuracy + aimingBonus - movementPenalty
    );

    // Calculate shot direction using reusable vectors
    WeaponSystem.tempDirection.copy(WeaponSystem.FORWARD);
    
    // Apply the camera's current rotation including recoil effects
    // This ensures the shot direction matches what the player sees
    WeaponSystem.tempDirection.applyQuaternion(this.camera.quaternion);
    
    // Add spread based on accuracy (reduced to make aiming more reliable)
    const spread = (1 - this.weaponState.currentAccuracy) * 0.07;
    WeaponSystem.tempDirection.x += (Math.random() - 0.5) * spread;
    WeaponSystem.tempDirection.y += (Math.random() - 0.5) * spread;
    WeaponSystem.tempDirection.normalize();

    // Create shot info using reusable vector
    const shotInfo: ShotInfo = {
      origin: WeaponSystem.tempVector.copy(this.camera.position),
      direction: WeaponSystem.tempDirection.clone(), // Need to clone for shot record
      weapon: this.currentWeapon,
      timestamp: now,
    };

    // Update weapon state
    this.currentWeapon.currentAmmo--;
    this.currentWeapon.lastShotTime = now;

    // Auto-reload when empty
    if (this.currentWeapon.currentAmmo === 0 && this.currentWeapon.totalAmmo > 0) {
      this.startReload();
    }

    // Create muzzle flash effect
    this.createMuzzleFlash();

    // Notify shot handler
    this.onShoot(shotInfo);
    return true;
  }

  private createMuzzleFlash(): void {
    if (!this.weaponMesh) return;

    // Create muzzle flash light
    const light = new THREE.PointLight(0xffaa00, 5, 2); // Increased intensity
    light.position.set(0, 0, -1).add(this.weaponMesh.position);
    this.weaponMesh.add(light);

    // Create visible muzzle flash mesh - cone shape pointing forward
    const flashGeometry = new THREE.ConeGeometry(0.15, 0.3, 8);
    const flashMaterial = new THREE.MeshStandardMaterial({
      color: 0xffff00, // Brighter yellow
      transparent: true,
      opacity: 0.9,
      emissive: 0xffaa00,
      emissiveIntensity: 2.0
    });
    
    const flashMesh = new THREE.Mesh(flashGeometry, flashMaterial);
    // Position at the end of the weapon and rotate to point forward
    flashMesh.position.set(0, 0, -1.05).add(this.weaponMesh.position);
    flashMesh.rotation.x = -Math.PI / 2; // Rotate to point forward
    this.weaponMesh.add(flashMesh);
    
    // Add small bright core at the center
    const coreGeometry = new THREE.SphereGeometry(0.05, 8, 8);
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, // Pure white
      transparent: true,
      opacity: 1.0,
      emissive: 0xffffff,
      emissiveIntensity: 3.0
    });
    
    const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
    coreMesh.position.copy(flashMesh.position);
    this.weaponMesh.add(coreMesh);

    // Remove after a short delay
    setTimeout(() => {
      if (light.parent) {
        light.parent.remove(light);
      }
      if (flashMesh.parent) {
        flashMesh.parent.remove(flashMesh);
      }
      if (coreMesh.parent) {
        coreMesh.parent.remove(coreMesh);
      }
    }, 50);
  }

  public update(deltaTime: number): void {
    // Update camera jerk effect - optimize this code
    if (this.cameraJerkEffect && this.cameraJerkEffect.length() > 0.0001) {
      // Apply camera jerk recovery
      const recovery = Math.min(1, this.cameraJerkDecay * deltaTime);
      
      // Reduce jerk effect over time - simplified calculation
      this.cameraJerkEffect.multiplyScalar(Math.max(0, 1 - recovery));
      
      // Apply recovery only if effect is significant enough
      if (this.cameraJerkEffect.length() > 0.001) {
        // Apply smooth recovery directly without redundant calculations
        WeaponSystem.tempQuaternion.setFromAxisAngle(WeaponSystem.xAxis, -this.cameraJerkEffect.y * recovery);
        this.camera.quaternion.multiply(WeaponSystem.tempQuaternion);
        
        WeaponSystem.tempQuaternion.setFromAxisAngle(WeaponSystem.yAxis, -this.cameraJerkEffect.x * recovery);
        this.camera.quaternion.multiply(WeaponSystem.tempQuaternion);
        
        this.camera.rotation.setFromQuaternion(this.camera.quaternion);
      } else {
        // Clear effect when it's small enough
        this.cameraJerkEffect = null;
      }
    }

    // Update recoil recovery
    if (this.currentWeapon && this.weaponState.currentRecoil.length() > 0) {
      const recovery = this.currentWeapon.stats.recoilRecoverySpeed * deltaTime;
      
      // Track previous recoil for recovery calculation
      const previousRecoil = this.weaponState.currentRecoil.clone();
      
      // Reduce current recoil
      this.weaponState.currentRecoil.multiplyScalar(Math.max(0, 1 - recovery));

      // Calculate the actual recovery amount
      const yRecovery = previousRecoil.y - this.weaponState.currentRecoil.y;
      const xRecovery = previousRecoil.x - this.weaponState.currentRecoil.x;
      
      // Apply recoil recovery to camera at 1:1 ratio for consistent feel
      if (Math.abs(yRecovery) > 0.0001 || Math.abs(xRecovery) > 0.0001) {
        WeaponSystem.tempQuaternion.setFromAxisAngle(WeaponSystem.xAxis, -yRecovery);
        this.camera.quaternion.multiply(WeaponSystem.tempQuaternion);
        
        WeaponSystem.tempQuaternion.setFromAxisAngle(WeaponSystem.yAxis, -xRecovery);
        this.camera.quaternion.multiply(WeaponSystem.tempQuaternion);
        
        // Update Euler angles to match quaternion
        this.camera.rotation.setFromQuaternion(this.camera.quaternion);
      }
    }

    // Update weapon model position when aiming or reloading
    if (this.weaponMesh) {
      let targetPosition;
      const targetRotation = new THREE.Euler(0, 0, 0);
      
      if (this.currentWeapon?.isReloading && this.reloadAnimationStartTime !== null) {
        // Calculate reload progress (0 to 1)
        const elapsedTime = (performance.now() - this.reloadAnimationStartTime) / 1000;
        const reloadDuration = this.currentWeapon.stats.reloadTime;
        const progress = Math.min(elapsedTime / reloadDuration, 1);
        
        // Animate the magazine during reload - optimize animation
        if (this.magazineMesh) {
          // Simplified animation with fewer phase calculations
          if (progress < 0.4) {
            // Magazine moving out - dropping down and rotating
            const dropProgress = progress / 0.4;
            this.magazineMesh.position.y = this.getMagazineOriginForWeapon(this.currentWeapon.type).y - (dropProgress * 0.3);
            this.magazineMesh.rotation.x = dropProgress * 0.2;
            this.magazineMesh.visible = true;
          } else if (progress < 0.6) {
            // Magazine out - not visible
            this.magazineMesh.visible = false;
          } else {
            // New magazine coming in - simplified calculation
            const insertProgress = (progress - 0.6) / 0.4;
            this.magazineMesh.position.y = this.getMagazineOriginForWeapon(this.currentWeapon.type).y - ((1 - insertProgress) * 0.3);
            this.magazineMesh.rotation.x = (1 - insertProgress) * 0.2;
            this.magazineMesh.visible = true;
            
            // Less frequent effect creation - only run once at 85% completion
            if (insertProgress > 0.84 && insertProgress < 0.87) {
              this.createMagazineInsertEffect();
            }
          }
        }
        
        // Create reload animation based on weapon type - simplified animations
        switch (this.currentWeapon.type) {
          case 'RIFLE':
          case 'SMG': {
            // Simplified reload animation
            targetPosition = new THREE.Vector3(0.4, -0.1, -0.6);
            // Use simpler sin calculation
            const tiltAmount = Math.sin(progress * Math.PI) * 0.5; 
            targetRotation.z = tiltAmount;
            targetRotation.x = tiltAmount * 0.2; // Reduced from 0.3
            break;
          }
          case 'PISTOL':
            targetPosition = new THREE.Vector3(0.4, -0.4, -0.6);
            targetRotation.z = Math.sin(progress * Math.PI) * 0.25; // Reduced from 0.3
            break;
          case 'SNIPER':
            targetPosition = new THREE.Vector3(0.5, -0.3, -0.7);
            targetRotation.z = Math.sin(progress * Math.PI) * 0.3; // Reduced from 0.4
            targetRotation.y = Math.sin(progress * Math.PI) * 0.15; // Reduced from 0.2
            break;
          default:
            targetPosition = new THREE.Vector3(0.3, -0.3, -0.8);
            break;
        }
      } else {
        // Regular aiming/hip position
        targetPosition = this.weaponState.isAiming
          ? new THREE.Vector3(0, -0.2, -0.5) // Aim position
          : new THREE.Vector3(0.3, -0.3, -0.8); // Hip position
      }

      // Less aggressive interpolation (reduced from 5 to 4)
      const lerpFactor = 4 * deltaTime;
      this.weaponMesh.position.lerp(targetPosition, lerpFactor);
      
      // Smoother rotation with less aggressive interpolation
      this.weaponMesh.rotation.x += (targetRotation.x - this.weaponMesh.rotation.x) * lerpFactor;
      this.weaponMesh.rotation.y += (targetRotation.y - this.weaponMesh.rotation.y) * lerpFactor;
      this.weaponMesh.rotation.z += (targetRotation.z - this.weaponMesh.rotation.z) * lerpFactor;
    }
  }

  public setMoving(moving: boolean): void {
    this.isMoving = moving;
  }

  public setAiming(isAiming: boolean): void {
    if (this.weaponState.isAiming !== isAiming) {
      this.weaponState.isAiming = isAiming;
      
      // Update accuracy for aiming
      if (this.currentWeapon) {
        const aimingBonus = isAiming ? 0.15 : 0;
        const movementPenalty = this.isMoving ? this.currentWeapon.stats.movementAccuracyPenalty : 0;
        this.weaponState.currentAccuracy = Math.max(
          0.1,
          this.currentWeapon.stats.accuracy + aimingBonus - movementPenalty
        );
      }
    }
  }

  public getCurrentWeapon(): Weapon | null {
    return this.currentWeapon;
  }

  public getWeaponState(): WeaponState {
    return this.weaponState;
  }

  public cleanup(): void {
    if (this.reloadTimeout !== null) {
      window.clearTimeout(this.reloadTimeout);
      this.reloadTimeout = null;
    }
    
    this.reloadAnimationStartTime = null;
    this.cameraJerkEffect = null;
    
    // Clean up particle pool
    this.particlePool.forEach(particle => {
      if (particle.parent) {
        particle.parent.remove(particle);
      }
    });
    
    // Remove weapon model
    if (this.weaponMesh && this.weaponMesh.parent) {
      this.weaponMesh.parent.remove(this.weaponMesh);
      this.weaponMesh = null;
      this.magazineMesh = null;
    }
  }

  // Helper method to get original magazine position based on weapon type
  private getMagazineOriginForWeapon(type: WeaponType): THREE.Vector3 {
    switch (type) {
      case 'RIFLE':
        return new THREE.Vector3(0, -0.1, 0.1);
      case 'SMG':
        return new THREE.Vector3(0, -0.1, 0.05);
      case 'PISTOL':
        return new THREE.Vector3(0, -0.1, 0);
      case 'SNIPER':
        return new THREE.Vector3(0, -0.1, 0.2);
      default:
        return new THREE.Vector3(0, -0.1, 0);
    }
  }

  // Create a visual effect when inserting a new magazine
  private createMagazineInsertEffect(): void {
    if (!this.weaponMesh || !this.magazineMesh) return;
    
    // Throttle effect to prevent multiple calls in short succession
    const now = performance.now();
    if (now - this.lastInsertEffectTime < 250) return; // Increased throttle time
    this.lastInsertEffectTime = now;
    
    // Create a more visible light effect since we're not changing magazine color
    const light = new THREE.PointLight(0x66aaff, 1.5, 0.5);
    light.position.copy(this.magazineMesh.position);
    this.weaponMesh.add(light);
    
    // Remove magazine glow effect completely - magazine should stay the original color
    
    // Use more particles to compensate for removed magazine glow
    const particleCount = 2; // Always use 2 particles
    
    for (let i = 0; i < particleCount; i++) {
      if (i >= this.particlePool.length) break;
      
      const particle = this.particlePool[i];
      if (!particle.parent) {
        this.weaponMesh.add(particle);
      }
      
      // Reset particle state
      particle.visible = true;
      const material = particle.material as THREE.MeshBasicMaterial;
      material.opacity = 0.9; // Slightly more visible
      
      // Position around the magazine
      particle.position.copy(this.magazineMesh.position);
      particle.position.x += (Math.random() - 0.5) * 0.05;
      particle.position.y += (Math.random() - 0.5) * 0.05;
      particle.position.z += (Math.random() - 0.5) * 0.05;
      
      // More distinctive particle movement
      const direction = new THREE.Vector3(
        (Math.random() - 0.5) * 0.03,
        0.025 + Math.random() * 0.015,  // More noticeable upward movement
        (Math.random() - 0.5) * 0.03
      );
      
      // Animation frames
      let frameCount = 0;
      const maxFrames = 12; // Slightly longer animation
      
      const animateParticle = () => {
        if (frameCount >= maxFrames || !particle.parent) {
          particle.visible = false;
          return;
        }
        
        // Move particle
        particle.position.add(direction);
        
        // Fade out
        material.opacity = 0.9 * (1 - frameCount / maxFrames);
        
        // Continue animation
        frameCount++;
        setTimeout(animateParticle, 20);
      };
      
      // Start animation
      animateParticle();
    }
    
    // Add a small flash effect at magazine position
    const flashGeometry = new THREE.SphereGeometry(0.05, 6, 6);
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0x99ccff,
      transparent: true,
      opacity: 0.7
    });
    
    const flashMesh = new THREE.Mesh(flashGeometry, flashMaterial);
    flashMesh.position.copy(this.magazineMesh.position);
    this.weaponMesh.add(flashMesh);
    
    // Animate flash expanding and fading
    let flashScale = 1.0;
    let flashOpacity = 0.7;
    
    const animateFlash = () => {
      if (flashOpacity <= 0.05 || !flashMesh.parent) {
        if (flashMesh.parent) {
          flashMesh.parent.remove(flashMesh);
        }
        return;
      }
      
      // Expand and fade
      flashScale += 0.15;
      flashOpacity -= 0.1;
      
      flashMesh.scale.set(flashScale, flashScale, flashScale);
      flashMaterial.opacity = flashOpacity;
      
      setTimeout(animateFlash, 16);
    };
    
    // Start flash animation
    setTimeout(animateFlash, 10);
    
    // Remove light after a short delay
    setTimeout(() => {
      if (light.parent) {
        light.parent.remove(light);
      }
    }, 150);
  }
} 