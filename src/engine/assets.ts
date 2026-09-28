import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MODEL_ASSETS, ROBOT_SKINS, type ModelAsset, type ModelKey } from '../data/assets';

/** 종류별 목표 크기. 외부 모델은 이 상자 안에 들어가도록 축척된다. baseY는 모델 바닥 높이. */
export const FIT: Record<ModelKey, { height: number; width: number; baseY: number }> = {
  robot: { height: 3.2, width: 2.6, baseY: 0 },
  drone: { height: 0.9, width: 1.2, baseY: 0.55 },
  tank: { height: 1.8, width: 3.0, baseY: 0 },
  shielder: { height: 2.2, width: 1.6, baseY: 0 },
  // 비행체는 모델 기준 높이 0에 맞춘 뒤, 전투에서 FLY_ALTITUDE만큼 띄운다
  flyer: { height: 0.9, width: 2.2, baseY: 0 },
  bomber: { height: 1.2, width: 1.3, baseY: 0 },
  regen: { height: 1.8, width: 2.2, baseY: 0 },
  boss: { height: 4.2, width: 5, baseY: 0 },
  juggernaut: { height: 2.6, width: 3.8, baseY: 0 },
};

/** 비행 유닛이 떠 있는 높이 */
export const FLY_ALTITUDE = 4.5;

interface LoadedModel {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  asset: ModelAsset;
}

const cache = new Map<ModelKey, LoadedModel>();

/** 존재하지 않는 파일이면 null. (Vite 개발 서버는 없는 경로에 index.html을 돌려주므로 content-type도 확인) */
export async function fetchBinary(path: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(import.meta.env.BASE_URL + path);
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/** 로봇 디자인(스킨) id → 불러온 모델 */
const skinCache = new Map<string, LoadedModel>();

async function loadOne(loader: GLTFLoader, asset: ModelAsset, warnings: string[]): Promise<LoadedModel | null> {
  const buf = await fetchBinary(asset.url);
  if (!buf) {
    warnings.push(`${asset.url}: 파일을 찾을 수 없음`);
    return null;
  }
  try {
    const base = import.meta.env.BASE_URL + asset.url.substring(0, asset.url.lastIndexOf('/') + 1);
    const gltf = await loader.parseAsync(buf, base);
    return { scene: gltf.scene, clips: gltf.animations, asset };
  } catch (e) {
    warnings.push(`${asset.url}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** 매니페스트의 모델과 로봇 디자인을 모두 불러온다. 실패한 항목은 경고 목록으로 돌려주고 절차적 모델로 대체된다. */
export async function loadModels(): Promise<string[]> {
  const loader = new GLTFLoader();
  const warnings: string[] = [];
  await Promise.all([
    ...(Object.entries(MODEL_ASSETS) as [ModelKey, ModelAsset][]).map(async ([key, asset]) => {
      const loaded = await loadOne(loader, asset, warnings);
      if (loaded) cache.set(key, loaded);
    }),
    ...ROBOT_SKINS.filter((s) => s.asset).map(async (skin) => {
      const loaded = await loadOne(loader, skin.asset!, warnings);
      if (loaded) skinCache.set(skin.id, loaded);
    }),
  ]);
  return warnings;
}

/** 로봇 디자인 인스턴스. 절차적 디자인이거나 불러오지 못했으면 null */
export function instantiateSkin(id: string): { inst: ModelInstance; asset: ModelAsset } | null {
  const loaded = skinCache.get(id);
  if (!loaded) return null;
  return { inst: createInstance(loaded.scene, loaded.clips, loaded.asset, 'robot'), asset: loaded.asset };
}

export function hasModel(key: ModelKey): boolean {
  return cache.has(key);
}

type EmissiveMaterial = THREE.Material & { emissive: THREE.Color };

export interface Flashable {
  mat: EmissiveMaterial;
  base: THREE.Color;
}

export interface ModelInstance {
  root: THREE.Group;
  /** 복제된 glTF 장면 (뼈대 찾기용) */
  model: THREE.Group;
  clips: THREE.AnimationClip[];
  flashables: Flashable[];
  mixer: THREE.AnimationMixer | null;
  idle: THREE.AnimationAction | null;
  walk: THREE.AnimationAction | null;
  fit: { height: number; width: number; baseY: number };
  /** 축척 후 실제 크기 */
  size: THREE.Vector3;
}

function findClip(clips: THREE.AnimationClip[], name: string | undefined, pattern: RegExp): THREE.AnimationClip | null {
  if (name) return clips.find((c) => c.name === name) ?? null;
  return clips.find((c) => pattern.test(c.name)) ?? null;
}

/** 캐시된 모델을 복제해 크기를 맞춘 인스턴스를 만든다. 모델이 없으면 null. */
export function instantiateModel(key: ModelKey): ModelInstance | null {
  const loaded = cache.get(key);
  return loaded ? createInstance(loaded.scene, loaded.clips, loaded.asset, key) : null;
}

export function modelAsset(key: ModelKey): ModelAsset | null {
  return cache.get(key)?.asset ?? null;
}

/** 불러온 glTF 장면을 복제해 종류별 목표 크기에 맞춘다. (게임과 개발용 뷰어가 함께 쓴다) */
export function createInstance(
  scene: THREE.Group,
  clips: THREE.AnimationClip[],
  asset: ModelAsset,
  key: ModelKey,
): ModelInstance {
  const loaded = { scene, clips, asset };
  const fit = FIT[key];

  const model = cloneSkinned(loaded.scene) as THREE.Group;
  model.rotation.y = loaded.asset.rotationY ?? 0;
  const holder = new THREE.Group();
  holder.add(model);
  holder.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = Math.min(fit.height / Math.max(size.y, 1e-3), fit.width / Math.max(size.x, size.z, 1e-3));
  holder.scale.setScalar(s);
  holder.position.set(-center.x * s, fit.baseY - box.min.y * s, -center.z * s);

  const root = new THREE.Group();
  root.add(holder);

  // 재질을 개체별로 복제해 피격 번쩍임이 다른 개체에 번지지 않게 한다
  const flashables: Flashable[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const cloneMat = (m: THREE.Material) => {
      const c = m.clone();
      if ('emissive' in c && c.emissive instanceof THREE.Color) {
        flashables.push({ mat: c as EmissiveMaterial, base: c.emissive.clone() });
      }
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cloneMat) : cloneMat(mesh.material);
  });

  let mixer: THREE.AnimationMixer | null = null;
  let idle: THREE.AnimationAction | null = null;
  let walk: THREE.AnimationAction | null = null;
  if (loaded.clips.length) {
    mixer = new THREE.AnimationMixer(model);
    const idleClip = findClip(loaded.clips, loaded.asset.idleClip, /idle/i) ?? loaded.clips[0];
    const walkClip = findClip(loaded.clips, loaded.asset.walkClip, /walk|run/i);
    idle = mixer.clipAction(idleClip);
    idle.play();
    if (walkClip && walkClip !== idleClip) {
      walk = mixer.clipAction(walkClip);
      walk.setEffectiveWeight(0);
      walk.play();
    }
  }

  return { root, model, clips: loaded.clips, flashables, mixer, idle, walk, fit, size: size.multiplyScalar(s) };
}

export function setFlash(flashables: Flashable[], color: THREE.Color | null): void {
  for (const f of flashables) f.mat.emissive.copy(color ?? f.base);
}
