import * as THREE from 'three';
import { SLOTS } from '../data/robot';
import { WEAPON_MAP } from '../data/weapons';
import { MODULE_MAP } from '../data/modules';
import { FLY_ALTITUDE, instantiateModel, instantiateSkin, setFlash, type Flashable, type ModelInstance } from './assets';
import type { ModelAsset } from '../data/assets';
import type { EnemyDef, Loadout, SlotId } from '../game/types';

// MVP용 절차적 모델. 이후 glTF 에셋으로 교체할 때 이 파일의 빌더만 바꾸면 된다.

function std(color: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.5, ...opts });
}

function glow(color: number, intensity = 2.5): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity });
}

function shadowed<T extends THREE.Mesh>(mesh: T): T {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
  m.position.set(x, y, z);
  return m;
}

/** z축(정면) 방향 원기둥 */
function cylZ(r: number, len: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(r, r, len, 12).rotateX(Math.PI / 2);
  const m = shadowed(new THREE.Mesh(geo, mat));
  m.position.set(x, y, z);
  return m;
}

export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => m.dispose());
  });
}

// ─── 무기 ────────────────────────────────────────────────

/** 정면(+z)을 향하는 무기 메시. userData.muzzle에 총구 위치 Object3D가 들어 있다. */
export function buildWeapon(id: string): THREE.Group {
  const def = WEAPON_MAP[id];
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  g.add(muzzle);
  g.userData.muzzle = muzzle;

  const metal = std(0x5a6470, { metalness: 0.7, roughness: 0.35 });
  const dark = std(0x22272e, { roughness: 0.7 });
  const light = glow(def.color);

  switch (id) {
    case 'autocannon':
      g.add(box(0.36, 0.36, 0.7, dark, 0, 0, 0.1));
      g.add(cylZ(0.13, 0.25, metal, 0, 0.05, 0.55));
      g.add(cylZ(0.08, 1.0, metal, 0, 0.05, 1.0));
      g.add(box(0.22, 0.3, 0.3, metal, 0, -0.3, 0));
      muzzle.position.set(0, 0.05, 1.55);
      break;
    case 'missile':
      g.add(box(0.8, 0.55, 0.75, metal));
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          g.add(cylZ(0.08, 0.05, light, -0.25 + col * 0.25, -0.12 + row * 0.24, 0.38));
        }
      }
      muzzle.position.set(0, 0, 0.45);
      break;
    case 'rocket':
      // 팔에 거는 2연장 발사관
      g.add(box(0.4, 0.3, 0.6, dark, 0, -0.05, 0));
      for (const x of [-0.11, 0.11]) {
        g.add(cylZ(0.11, 0.95, metal, x, 0.12, 0.35));
        g.add(cylZ(0.075, 0.04, light, x, 0.12, 0.83));
      }
      g.add(box(0.14, 0.12, 0.2, light, 0, -0.05, 0.32));
      muzzle.position.set(0, 0.12, 0.9);
      break;
    case 'railgun':
      g.add(box(0.32, 0.32, 0.9, dark, 0, 0, 0.1));
      g.add(box(0.07, 0.14, 1.9, metal, -0.1, 0, 1.1));
      g.add(box(0.07, 0.14, 1.9, metal, 0.1, 0, 1.1));
      g.add(box(0.05, 0.05, 1.7, light, 0, 0, 1.1));
      muzzle.position.set(0, 0, 2.1);
      break;
    case 'laser': {
      g.add(cylZ(0.17, 0.8, dark, 0, 0, 0.3));
      g.add(cylZ(0.1, 0.4, metal, 0, 0, 0.8));
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), light);
      lens.position.z = 1.02;
      g.add(lens);
      muzzle.position.set(0, 0, 1.1);
      break;
    }
    case 'mortar': {
      g.add(box(0.7, 0.4, 0.7, dark, 0, 0, 0));
      // 위로 비스듬히 선 포신
      const tube = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 1.1, 12), metal));
      tube.rotation.x = Math.PI / 4;
      tube.position.set(0, 0.45, 0.3);
      g.add(tube);
      g.add(box(0.3, 0.06, 0.06, light, 0, 0.1, 0.36));
      muzzle.position.set(0, 0.85, 0.7);
      break;
    }
    case 'flamethrower': {
      g.add(cylZ(0.14, 0.9, dark, 0, 0, 0.4));
      g.add(cylZ(0.2, 0.18, metal, 0, 0, 0.9));
      const tank = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.6, 10), std(0xb8471f)));
      tank.position.set(0, -0.25, 0);
      g.add(tank);
      g.add(box(0.12, 0.12, 0.05, light, 0, 0, 1.0));
      muzzle.position.set(0, 0, 1.05);
      break;
    }
    case 'gauss': {
      // 긴 포신을 코일 고리가 감싼 형태
      g.add(box(0.4, 0.4, 0.9, dark, 0, 0, 0.1));
      g.add(cylZ(0.09, 2.4, metal, 0, 0, 1.4));
      for (let i = 0; i < 5; i++) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 6, 16), light);
        coil.position.z = 0.7 + i * 0.4;
        g.add(coil);
      }
      muzzle.position.set(0, 0, 2.65);
      break;
    }
    case 'emp': {
      // 위를 향한 접시형 방사기
      g.add(box(0.6, 0.3, 0.6, dark, 0, 0, 0));
      const dish = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.15, 0.2, 16), metal));
      dish.position.y = 0.3;
      g.add(dish);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), light);
      core.position.y = 0.5;
      g.add(core);
      muzzle.position.set(0, 0.5, 0);
      break;
    }
    case 'flak': {
      g.add(box(0.6, 0.35, 0.6, dark, 0, 0, 0));
      for (const x of [-0.12, 0.12]) {
        const barrel = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), metal));
        barrel.rotation.x = Math.PI / 3;
        barrel.position.set(x, 0.4, 0.35);
        g.add(barrel);
      }
      g.add(box(0.4, 0.06, 0.06, light, 0, 0.2, 0.31));
      muzzle.position.set(0, 0.7, 0.85);
      break;
    }
    default:
      g.add(box(0.3, 0.3, 0.8, metal));
      muzzle.position.set(0, 0, 0.5);
  }
  return g;
}

/** 등에 메는 코어 모듈 (-z 방향으로 붙는다) */
export function buildModule(id: string): THREE.Group {
  const def = MODULE_MAP[id];
  const g = new THREE.Group();
  const dark = std(0x2a3038, { roughness: 0.6 });
  g.add(box(1.0, 0.8, 0.4, dark, 0, 0, -0.2));
  g.add(box(0.7, 0.12, 0.05, glow(def.color, 2.5), 0, 0.15, -0.42));
  g.add(box(0.7, 0.12, 0.05, glow(def.color, 2.5), 0, -0.1, -0.42));
  const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 10), glow(def.color, 1.8));
  cell.rotation.z = Math.PI / 2;
  cell.position.set(0, 0.5, -0.2);
  g.add(cell);
  return g;
}

// ─── 로봇 ────────────────────────────────────────────────

export interface RobotModel {
  group: THREE.Group;
  weaponMeshes: Record<SlotId, THREE.Group | null>;
  setLoadout(loadout: Loadout): void;
  setHitFlash(v: number): void;
  animateWalk(phase: number, amount: number): void;
  update(dt: number): void;
  /** 승리·파괴 애니메이션. 모델에 해당 클립이 없으면 false */
  playSpecial(kind: 'victory' | 'death'): boolean;
  /** 특수 애니메이션을 끝내고 기본 자세로 */
  resetPose(): void;
  /** 다리(몸 전체) 방향에 대한 상체 비틀림(라디안). 0이면 정면. 연출 전용 */
  setTorsoYaw(yaw: number): void;
}

const SPECIAL_CLIPS = { victory: /dance|victory|cheer|yes/i, death: /death|die/i };

type Vec3 = [number, number, number];

/** 슬롯 장착 지점과 무기·모듈 교체 로직 (절차적·외부 모델 공용) */
function makeMounts(parent: THREE.Object3D, positions: Record<SlotId, Vec3>) {
  const mounts = {} as Record<SlotId, THREE.Object3D>;
  for (const slot of SLOTS) {
    const m = new THREE.Object3D();
    m.position.set(...positions[slot.id]);
    parent.add(m);
    mounts[slot.id] = m;
  }
  const weaponMeshes: Record<SlotId, THREE.Group | null> = { armL: null, armR: null, shoulder: null, shoulder2: null, core: null };
  const setLoadout = (loadout: Loadout) => {
    for (const slot of SLOTS) {
      const old = weaponMeshes[slot.id];
      if (old) {
        mounts[slot.id].remove(old);
        disposeObject(old);
      }
      const id = loadout[slot.id];
      const mesh = id ? (slot.type === 'core' ? buildModule(id) : buildWeapon(id)) : null;
      if (mesh) mounts[slot.id].add(mesh);
      weaponMeshes[slot.id] = mesh;
    }
  };
  return { weaponMeshes, setLoadout, mounts };
}

const HIT_RED = new THREE.Color();

/** 고른 디자인(스킨)으로 로봇을 만든다. 절차적 디자인이거나 모델을 불러오지 못했으면 기본 로봇. */
export function buildRobot(skinId: string): RobotModel {
  const skin = instantiateSkin(skinId);
  return skin ? buildModelRobot(skin.inst, skin.asset) : buildProceduralRobot();
}

/** 외부 모델 로봇. 무기 장착 지점은 매니페스트의 mounts, 없으면 크기 비율로 정한다. */
export function buildModelRobot(inst: ModelInstance, asset: ModelAsset): RobotModel {
  const group = new THREE.Group();
  group.add(inst.root);
  const h = inst.size.y;
  const halfW = inst.size.x / 2;
  // 뼈대에 붙이는 메카형(몸통 양옆에 포가 있음)은 포 위에 얹히도록 조금 바깥·위로 잡는다.
  // (레드판다 기준으로 맞춘 비율이며, 크기가 다른 다른 메카에도 같은 비율로 적용된다)
  const armX = asset.mountBone ? halfW * 1.04 : halfW * 0.9;
  const armY = asset.mountBone ? h * 0.67 : h * 0.55;
  const armZ = asset.mountBone ? 0.25 : 0.2;
  const positions: Record<SlotId, Vec3> = {
    armL: [-armX, armY, armZ],
    armR: [armX, armY, armZ],
    shoulder: [halfW * 0.5, h * 0.9, -0.2],
    shoulder2: [-halfW * 0.5, h * 0.9, -0.2],
    core: [0, h * 0.62, -inst.size.z / 2 - 0.1],
    ...asset.mounts,
  };
  const { weaponMeshes, setLoadout, mounts } = makeMounts(group, positions);

  // 뼈대가 지정되면 장착 지점을 그 뼈대로 옮겨, 걷거나 몸을 돌릴 때 무기가 함께 움직이게 한다.
  // attach()는 월드 변환을 유지하므로 뼈대의 축척(자동 크기 맞춤)이 무기 크기에 영향을 주지 않는다.
  const bone = asset.mountBone ? inst.model.getObjectByName(asset.mountBone) : undefined;
  if (bone) {
    group.updateMatrixWorld(true);
    for (const m of Object.values(mounts)) bone.attach(m);
  }

  let special: THREE.AnimationAction | null = null;

  // 상체 비틀기: 애니메이션이 매 프레임 뼈대 자세를 덮어쓰므로, 갱신 직후에 월드 Y축 회전을 덧붙인다.
  const torso = asset.torsoBone ? (inst.model.getObjectByName(asset.torsoBone) ?? null) : null;
  const torsoBase = torso?.quaternion.clone() ?? null;
  let torsoYaw = 0;
  const parentQ = new THREE.Quaternion();
  const twistQ = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const applyTwist = () => {
    if (!torso || !torso.parent) return;
    if (!inst.mixer && torsoBase) torso.quaternion.copy(torsoBase); // 애니메이션이 없으면 누적되지 않게 되돌린 뒤 적용
    if (Math.abs(torsoYaw) < 1e-4) return;
    // 월드 Y축을 부모 뼈대 좌표계로 옮겨, 그 축을 중심으로 돌린다
    torso.parent.getWorldQuaternion(parentQ);
    axis.set(0, 1, 0).applyQuaternion(parentQ.invert()).normalize();
    twistQ.setFromAxisAngle(axis, torsoYaw);
    torso.quaternion.premultiply(twistQ);
  };

  return {
    group,
    weaponMeshes,
    setLoadout,
    setTorsoYaw(yaw) {
      torsoYaw = yaw;
      if (!inst.mixer) applyTwist();
    },
    setHitFlash(v) {
      setFlash(inst.flashables, v > 0.01 ? HIT_RED.setRGB(v * 0.9, v * 0.15, v * 0.05) : null);
    },
    playSpecial(kind) {
      const clip = inst.clips.find((c) => SPECIAL_CLIPS[kind].test(c.name));
      if (!inst.mixer || !clip) return false;
      special?.stop();
      inst.idle?.setEffectiveWeight(0);
      inst.walk?.setEffectiveWeight(0);
      special = inst.mixer.clipAction(clip).reset().setEffectiveWeight(1);
      if (kind === 'death') {
        special.setLoop(THREE.LoopOnce, 1);
        special.clampWhenFinished = true;
      }
      special.play();
      return true;
    },
    resetPose() {
      special?.stop();
      special = null;
      inst.idle?.setEffectiveWeight(1);
      inst.walk?.setEffectiveWeight(0);
    },
    animateWalk(_phase, amount) {
      if (special) return;
      if (inst.walk && inst.idle) {
        inst.walk.setEffectiveWeight(amount);
        inst.idle.setEffectiveWeight(1 - amount);
      }
    },
    update(dt) {
      inst.mixer?.update(dt);
      if (inst.mixer) applyTwist();
    },
  };
}

function buildProceduralRobot(): RobotModel {
  const bodyMat = std(0x6f8296, { metalness: 0.6, roughness: 0.4 });
  const darkMat = std(0x2a3038, { metalness: 0.4, roughness: 0.7 });
  const accentMat = glow(0x33ddff, 2.2);

  const group = new THREE.Group();
  group.add(box(1.1, 0.35, 0.7, darkMat, 0, 1.35, 0));

  const makeLeg = (x: number): THREE.Group => {
    const leg = new THREE.Group();
    leg.position.set(x, 1.3, 0);
    leg.add(box(0.4, 0.65, 0.5, bodyMat, 0, -0.3, 0));
    leg.add(box(0.34, 0.6, 0.42, darkMat, 0, -0.85, 0.02));
    leg.add(box(0.5, 0.18, 0.8, bodyMat, 0, -1.2, 0.1));
    group.add(leg);
    return leg;
  };
  const legL = makeLeg(-0.42);
  const legR = makeLeg(0.42);

  const upper = new THREE.Group();
  upper.position.y = 1.5;
  group.add(upper);
  upper.add(box(1.6, 1.0, 1.0, bodyMat, 0, 0.55, 0));
  upper.add(box(1.2, 0.5, 0.2, darkMat, 0, 0.45, 0.55));
  upper.add(box(0.9, 0.12, 0.05, accentMat, 0, 0.82, 0.53));
  upper.add(box(0.6, 0.38, 0.6, bodyMat, 0, 1.25, 0.05));
  upper.add(box(0.45, 0.09, 0.04, accentMat, 0, 1.28, 0.37));
  upper.add(box(0.5, 0.55, 0.7, darkMat, -1.05, 0.7, 0));
  upper.add(box(0.5, 0.55, 0.7, darkMat, 1.05, 0.7, 0));

  const { weaponMeshes, setLoadout } = makeMounts(upper, {
    armL: [-1.1, 0.25, 0.15],
    armR: [1.1, 0.25, 0.15],
    shoulder: [0.75, 1.3, -0.25],
    shoulder2: [-0.75, 1.3, -0.25],
    core: [0, 0.6, -0.5],
  });

  return {
    group,
    weaponMeshes,
    setLoadout,
    setHitFlash(v) {
      bodyMat.emissive.setRGB(v * 0.9, v * 0.15, v * 0.05);
    },
    animateWalk(phase, amount) {
      const swing = Math.sin(phase) * 0.5 * amount;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      upper.position.y = 1.5 + Math.abs(Math.cos(phase)) * 0.06 * amount;
    },
    update() {},
    playSpecial: () => false,
    resetPose() {},
    setTorsoYaw(yaw) {
      // 기본 로봇은 상체 그룹(무기 포함)만 돌린다
      upper.rotation.y = yaw;
    },
  };
}

// ─── 적 ──────────────────────────────────────────────────

export interface EnemyModel {
  group: THREE.Group;
  /** 떠다니는 애니메이션 대상 (드론/실드 유닛) */
  body: THREE.Object3D;
  /** body의 기준 높이 (떠다니는 애니메이션의 중심) */
  bobBase: number;
  shield: THREE.Mesh | null;
  muzzle: THREE.Object3D;
  hitHeight: number;
  barHeight: number;
  setFlash(on: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

const FLASH_EMISSIVE = new THREE.Color(0x888888);

/**
 * 실드 구체 재질: 가운데는 거의 투명하고 가장자리만 빛난다(프레넬).
 * 균일한 반투명이면 위에서 볼 때 파란 원판처럼 보여 안의 모델과 피해 숫자를 가린다.
 * 밝기는 setShieldOpacity로 바꾼다.
 */
export function makeShieldMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.3 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.5);
        gl_FragColor = vec4(uColor, uOpacity * (0.08 + rim * 1.6));
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

export function setShieldOpacity(mesh: THREE.Mesh, opacity: number): void {
  (mesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = opacity;
}

function makeShieldSphere(radius: number, y: number): THREE.Mesh {
  const shield = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), makeShieldMaterial(0x4fb3ff));
  shield.position.y = y;
  return shield;
}

export function buildEnemy(def: EnemyDef): EnemyModel {
  const inst = instantiateModel(def.model);
  const model = inst ? buildModelEnemy(def, inst) : buildProceduralEnemy(def);
  return decorateEnemy(def, model);
}

/** 모델 종류와 상관없이 역할을 알아보게 하는 공통 장식 (비행 고도, 재생 고리, 자폭 경고등) */
function decorateEnemy(def: EnemyDef, model: EnemyModel): EnemyModel {
  const extras: THREE.Object3D[] = [];
  if (def.flying) {
    model.body.position.y += FLY_ALTITUDE;
    model.bobBase += FLY_ALTITUDE;
    model.hitHeight += FLY_ALTITUDE;
    model.barHeight += FLY_ALTITUDE;
  }
  if (def.hpRegen) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(def.radius * 1.2, 0.07, 6, 32), glow(0x3ddc84, 2.5));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    extras.push(ring);
  }
  if (def.elite) {
    // 강화형: 발밑에 금색 고리
    const ring = new THREE.Mesh(new THREE.TorusGeometry(def.radius * 1.5, 0.1, 6, 48), glow(0xffc23d, 3));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    extras.push(ring);
  }
  if (def.explode) {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), glow(0xff2a2a, 4));
    beacon.position.y = model.barHeight - 0.35;
    beacon.name = 'beacon';
    extras.push(beacon);
  }
  if (!extras.length) return model;
  extras.forEach((o) => model.group.add(o));
  const dispose = model.dispose;
  return {
    ...model,
    dispose() {
      extras.forEach((o) => {
        model.group.remove(o);
        disposeObject(o);
      });
      dispose();
    },
  };
}

function buildModelEnemy(def: EnemyDef, inst: ModelInstance): EnemyModel {
  const group = new THREE.Group();
  group.add(inst.root);
  const baseY = inst.fit.baseY;
  const h = inst.size.y;
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, baseY + h * 0.55, inst.size.z / 2);
  inst.root.add(muzzle);
  const shield = def.shield > 0 ? makeShieldSphere(Math.max(1.35, h * 0.6, inst.size.x * 0.6), baseY + h / 2) : null;
  if (shield) group.add(shield);
  // 적은 대부분 이동 중이므로 걷기 애니메이션을 기본으로 튼다
  if (inst.walk && inst.idle) {
    inst.walk.setEffectiveWeight(1);
    inst.idle.setEffectiveWeight(0);
  }
  return {
    group,
    body: inst.root,
    bobBase: 0,
    shield,
    muzzle,
    hitHeight: baseY + h * 0.5,
    barHeight: baseY + h + 0.5,
    setFlash(on) {
      setFlash(inst.flashables, on ? FLASH_EMISSIVE : null);
    },
    update(dt) {
      inst.mixer?.update(dt);
    },
    dispose() {
      // 지오메트리는 복제본끼리 공유하므로 개체별로 복제한 재질만 해제한다
      inst.flashables.forEach((f) => f.mat.dispose());
      if (shield) disposeObject(shield);
    },
  };
}

function proceduralEnemy(
  group: THREE.Group,
  parts: Omit<EnemyModel, 'group' | 'setFlash' | 'update' | 'dispose'>,
  mat: THREE.MeshStandardMaterial,
): EnemyModel {
  const flashables: Flashable[] = [{ mat, base: mat.emissive.clone() }];
  return {
    group,
    ...parts,
    setFlash(on) {
      setFlash(flashables, on ? FLASH_EMISSIVE : null);
    },
    update() {},
    dispose() {
      disposeObject(group);
    },
  };
}

function buildProceduralEnemy(def: EnemyDef): EnemyModel {
  const group = new THREE.Group();
  const muzzle = new THREE.Object3D();
  const dark = std(0x23282f, { roughness: 0.7 });

  switch (def.model) {
    case 'drone': {
      const mat = std(def.color, { emissive: 0x440808, metalness: 0.6, roughness: 0.3 });
      const body = new THREE.Group();
      body.position.y = 1;
      const core = shadowed(new THREE.Mesh(new THREE.OctahedronGeometry(0.42), mat));
      core.scale.y = 1.3;
      body.add(core);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 6, 20), dark);
      ring.rotation.x = Math.PI / 2;
      body.add(ring);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glow(0xffcc33, 3));
      eye.position.z = 0.33;
      body.add(eye);
      body.add(muzzle);
      group.add(body);
      return proceduralEnemy(group, { body, bobBase: 1, shield: null, muzzle, hitHeight: 1, barHeight: 1.9 }, mat);
    }
    case 'tank': {
      const mat = std(def.color, { metalness: 0.5, roughness: 0.6 });
      group.add(box(2.2, 0.8, 2.8, mat, 0, 0.75, 0));
      group.add(box(0.5, 0.7, 3.0, dark, -1.2, 0.35, 0));
      group.add(box(0.5, 0.7, 3.0, dark, 1.2, 0.35, 0));
      const turret = new THREE.Group();
      turret.position.y = 1.4;
      turret.add(box(1.3, 0.55, 1.4, mat));
      turret.add(cylZ(0.13, 1.8, dark, 0, 0, 1.3));
      turret.add(box(0.5, 0.08, 0.3, glow(0xff5522, 2), 0, 0.3, 0.4));
      muzzle.position.set(0, 0, 2.2);
      turret.add(muzzle);
      group.add(turret);
      return proceduralEnemy(group, { body: turret, bobBase: 1.4, shield: null, muzzle, hitHeight: 1, barHeight: 2.7 }, mat);
    }
    case 'shielder': {
      const mat = std(def.color, { metalness: 0.6, roughness: 0.35 });
      const body = new THREE.Group();
      const base = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.25, 16), dark));
      base.position.y = 0.3;
      group.add(base);
      const under = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 16), glow(0x4fb3ff, 2));
      under.position.y = 0.15;
      group.add(under);
      const torso = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.6, 4, 12), mat));
      torso.position.y = 1.15;
      body.add(torso);
      body.add(box(0.5, 0.1, 0.1, glow(0x9fe3ff, 3), 0, 1.4, 0.38));
      body.add(box(0.18, 0.18, 0.6, dark, 0.5, 1.05, 0.25));
      muzzle.position.set(0.5, 1.05, 0.6);
      body.add(muzzle);
      group.add(body);
      const shield = makeShieldSphere(1.35, 1.1);
      group.add(shield);
      return proceduralEnemy(group, { body, bobBase: 0, shield, muzzle, hitHeight: 1.1, barHeight: 2.8 }, mat);
    }
    case 'flyer': {
      // 고도는 decorateEnemy에서 올린다
      const mat = std(def.color, { metalness: 0.5, roughness: 0.4 });
      const body = new THREE.Group();
      const hull = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 8).rotateX(Math.PI / 2), mat));
      body.add(hull);
      body.add(box(2.2, 0.08, 0.6, mat, 0, 0, -0.2));
      body.add(box(0.08, 0.5, 0.4, dark, 0, 0.25, -0.6));
      body.add(box(0.5, 0.15, 0.1, glow(0xffb13b, 3), 0, 0, -0.8));
      muzzle.position.set(0, 0, 0.8);
      body.add(muzzle);
      group.add(body);
      return proceduralEnemy(group, { body, bobBase: 0, shield: null, muzzle, hitHeight: 0, barHeight: 0.9 }, mat);
    }
    case 'bomber': {
      const mat = std(def.color, { metalness: 0.4, roughness: 0.5, emissive: 0x330800 });
      const body = new THREE.Group();
      const shell = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), mat));
      shell.position.y = 0.6;
      body.add(shell);
      body.add(box(0.7, 0.12, 0.12, dark, 0, 0.6, 0.45));
      for (const [x, z] of [[-0.45, 0.3], [0.45, 0.3], [-0.45, -0.3], [0.45, -0.3]]) {
        const wheel = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 12).rotateZ(Math.PI / 2), dark));
        wheel.position.set(x, 0.18, z);
        group.add(wheel);
      }
      muzzle.position.set(0, 0.6, 0.5);
      body.add(muzzle);
      group.add(body);
      return proceduralEnemy(group, { body, bobBase: 0, shield: null, muzzle, hitHeight: 0.6, barHeight: 1.5 }, mat);
    }
    case 'regen': {
      const mat = std(0x5d6b63, { metalness: 0.5, roughness: 0.5 });
      group.add(box(1.8, 0.7, 1.4, mat, 0, 0.75, 0));
      group.add(box(0.9, 0.12, 0.25, glow(def.color, 3), 0, 1.16, 0));
      group.add(box(0.25, 0.12, 0.9, glow(def.color, 3), 0, 1.16, 0));
      for (let i = 0; i < 3; i++) {
        for (const x of [-0.95, 0.95]) {
          const wheel = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.25, 12).rotateZ(Math.PI / 2), dark));
          wheel.position.set(x, 0.3, -0.5 + i * 0.5);
          group.add(wheel);
        }
      }
      const turret = new THREE.Group();
      turret.position.y = 1.3;
      turret.add(cylZ(0.08, 0.8, dark, 0, 0, 0.4));
      muzzle.position.set(0, 0, 0.8);
      turret.add(muzzle);
      group.add(turret);
      return proceduralEnemy(group, { body: turret, bobBase: 1.3, shield: null, muzzle, hitHeight: 0.9, barHeight: 2.2 }, mat);
    }
    case 'juggernaut': {
      const mat = std(def.color, { metalness: 0.6, roughness: 0.55 });
      group.add(box(3, 1.2, 3.8, mat, 0, 1, 0));
      group.add(box(0.7, 1, 4.1, dark, -1.7, 0.5, 0));
      group.add(box(0.7, 1, 4.1, dark, 1.7, 0.5, 0));
      group.add(box(2.6, 0.2, 3.4, dark, 0, 1.7, 0));
      const turret = new THREE.Group();
      turret.position.y = 2.1;
      turret.add(box(1.9, 0.8, 2, mat));
      turret.add(cylZ(0.22, 2.6, dark, 0, 0, 1.9));
      turret.add(box(0.8, 0.12, 0.4, glow(0xff5522, 2.5), 0, 0.42, 0.6));
      muzzle.position.set(0, 0, 3.2);
      turret.add(muzzle);
      group.add(turret);
      return proceduralEnemy(group, { body: turret, bobBase: 2.1, shield: null, muzzle, hitHeight: 1.3, barHeight: 3.4 }, mat);
    }
    case 'boss': {
      const mat = std(def.color, { metalness: 0.6, roughness: 0.4 });
      const body = new THREE.Group();
      // 원반형 동체 (디스크 워커)
      const shell = shadowed(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), mat));
      shell.scale.set(2.6, 0.55, 2.6);
      shell.position.y = 2.4;
      body.add(shell);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.08, 6, 48), glow(0xff3355, 2));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 2.4;
      body.add(rim);
      body.add(box(0.9, 0.25, 0.1, glow(0xff3355, 4), 0, 2.6, 2.35));
      for (const x of [-0.7, 0.7]) body.add(cylZ(0.18, 2, dark, x, 2.2, 2.4));
      for (let i = 0; i < 6; i++) {
        const side = i < 3 ? -1 : 1;
        const z = -1.2 + (i % 3) * 1.2;
        const leg = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.6, 0.25), dark));
        leg.position.set(side * 2.1, 1.2, z);
        leg.rotation.z = side * 0.5;
        body.add(leg);
      }
      muzzle.position.set(0, 2.2, 3.4);
      body.add(muzzle);
      group.add(body);
      const shield = makeShieldSphere(3.4, 2.2);
      group.add(shield);
      return proceduralEnemy(group, { body, bobBase: 0, shield, muzzle, hitHeight: 2.4, barHeight: 4.6 }, mat);
    }
  }
}

