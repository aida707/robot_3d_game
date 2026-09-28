import * as THREE from 'three';

const PARTICLE_GEO = new THREE.BoxGeometry(1, 1, 1);
const SPHERE_GEO = new THREE.SphereGeometry(1, 16, 12);
const BEAM_GEO = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
const RING_GEO = new THREE.TorusGeometry(1, 0.04, 6, 48);
const UP = new THREE.Vector3(0, 1, 0);

interface Fx {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  vel?: THREE.Vector3;
  gravity?: number;
  /** 수명 동안 커지는 비율 */
  grow?: number;
  baseScale?: number;
  tick?: (t: number) => void;
}

function additive(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/** 수명이 짧은 시각 효과(폭발, 불꽃, 빔 잔상 등)를 관리한다. */
export class Effects {
  private list: Fx[] = [];

  constructor(private scene: THREE.Scene) {}

  private add(fx: Fx): void {
    this.scene.add(fx.mesh);
    this.list.push(fx);
  }

  explosion(pos: THREE.Vector3, radius: number, color = 0xff8833): void {
    const flash = new THREE.Mesh(SPHERE_GEO, additive(color, 0.9));
    flash.position.copy(pos);
    this.add({ mesh: flash, life: 0.35, max: 0.35, grow: 1.2, baseScale: radius * 0.5 });

    const core = new THREE.Mesh(SPHERE_GEO, additive(0xfff2cc, 1));
    core.position.copy(pos);
    this.add({ mesh: core, life: 0.15, max: 0.15, grow: 0.5, baseScale: radius * 0.3 });

    const count = Math.min(26, 8 + Math.round(radius * 6));
    const colors = [color, 0xffd166, 0x666666];
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(PARTICLE_GEO, additive(colors[i % colors.length]));
      p.position.copy(pos);
      const s = 0.08 + Math.random() * 0.15 * Math.sqrt(radius);
      p.scale.setScalar(s);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize();
      const life = 0.4 + Math.random() * 0.5;
      this.add({
        mesh: p,
        life,
        max: life,
        vel: dir.multiplyScalar((3 + Math.random() * 6) * Math.sqrt(radius)),
        gravity: 12,
        baseScale: s,
      });
    }
  }

  sparks(pos: THREE.Vector3, color: number, count = 4): void {
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(PARTICLE_GEO, additive(color));
      p.position.copy(pos);
      p.scale.setScalar(0.07);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      this.add({ mesh: p, life: 0.25, max: 0.25, vel: dir.multiplyScalar(4 + Math.random() * 4), gravity: 10, baseScale: 0.07 });
    }
  }

  flash(pos: THREE.Vector3, color: number, size = 0.3): void {
    const m = new THREE.Mesh(SPHERE_GEO, additive(color, 0.9));
    m.position.copy(pos);
    this.add({ mesh: m, life: 0.07, max: 0.07, baseScale: size });
  }

  smoke(pos: THREE.Vector3): void {
    const m = new THREE.Mesh(
      SPHERE_GEO,
      new THREE.MeshBasicMaterial({ color: 0x8a8f99, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    m.position.copy(pos);
    this.add({ mesh: m, life: 0.5, max: 0.5, grow: 2, baseScale: 0.12, vel: new THREE.Vector3(0, 0.6, 0) });
  }

  /** 화염방사기 불꽃: 총구에서 목표 방향으로 퍼지며 커지는 입자 */
  flame(from: THREE.Vector3, to: THREE.Vector3, range: number): void {
    const dir = new THREE.Vector3().subVectors(to, from).normalize();
    const speed = 11;
    const life = range / speed;
    // 겹치면 가산 혼합으로 하얗게 타 버리므로 입자 수와 불투명도를 낮게 유지한다
    if (Math.random() < 0.35) return;
    {
      const color = Math.random() < 0.6 ? 0xff5a14 : 0xffa53a;
      const m = new THREE.Mesh(SPHERE_GEO, additive(color, 0.35));
      m.position.copy(from);
      const vel = dir
        .clone()
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.3, Math.random() - 0.5).multiplyScalar(0.45))
        .normalize()
        .multiplyScalar(speed * (0.8 + Math.random() * 0.4));
      this.add({ mesh: m, life, max: life, vel, baseScale: 0.1, grow: 3 });
    }
  }

  /** 퍼져 나가는 고리 (EMP 펄스) */
  shockwave(pos: THREE.Vector3, radius: number, color: number): void {
    const ring = new THREE.Mesh(RING_GEO, additive(color, 0.8));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(pos);
    this.add({
      mesh: ring,
      life: 0.45,
      max: 0.45,
      tick: (t) => ring.scale.setScalar(0.5 + radius * (1 - t)),
    });
  }

  /** 짧게 남았다 가늘어지며 사라지는 빔 (레일건 궤적 등) */
  beam(from: THREE.Vector3, to: THREE.Vector3, color: number, width: number, life: number): void {
    const m = makeBeam(color);
    setBeam(m, from, to, width);
    this.add({
      mesh: m,
      life,
      max: life,
      tick: (t) => {
        m.scale.x = width * t;
        m.scale.z = width * t;
      },
    });
  }

  update(dt: number): void {
    const alive: Fx[] = [];
    for (const fx of this.list) {
      fx.life -= dt;
      if (fx.life <= 0) {
        this.scene.remove(fx.mesh);
        (fx.mesh.material as THREE.Material).dispose();
        continue;
      }
      const t = fx.life / fx.max;
      const m = fx.mesh;
      if (fx.vel) {
        m.position.addScaledVector(fx.vel, dt);
        if (fx.gravity) fx.vel.y -= fx.gravity * dt;
        if (m.position.y < 0.05) {
          m.position.y = 0.05;
          fx.vel.multiplyScalar(0.4);
          fx.vel.y = Math.abs(fx.vel.y);
        }
      }
      if (fx.baseScale !== undefined) {
        m.scale.setScalar(fx.baseScale * (1 + (1 - t) * (fx.grow ?? 0)));
      }
      (m.material as THREE.MeshBasicMaterial).opacity = t;
      fx.tick?.(t);
      alive.push(fx);
    }
    this.list = alive;
  }

  clear(): void {
    for (const fx of this.list) {
      this.scene.remove(fx.mesh);
      (fx.mesh.material as THREE.Material).dispose();
    }
    this.list = [];
  }
}

export function makeBeam(color: number): THREE.Mesh {
  return new THREE.Mesh(BEAM_GEO, additive(color, 0.9));
}

/** y축 원기둥을 from→to 방향으로 늘여 배치한다. */
export function setBeam(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, width: number): void {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  if (len > 1e-4) mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(len));
  mesh.scale.set(width, len, width);
}
