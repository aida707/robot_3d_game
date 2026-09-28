import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createInstance, fetchBinary, FIT, type ModelInstance } from '../engine/assets';
import { buildModelRobot, buildRobot } from '../engine/models';
import type { ModelAsset, ModelKey } from '../data/assets';
import type { Loadout } from '../game/types';

// 개발용 모델 뷰어 (http://localhost:5173/viewer.html)
// public/models 의 glTF를 게임과 같은 방식(자동 크기 맞춤, 방향 보정, 무기 장착)으로 보여 주고,
// src/data/assets.ts 에 붙여 넣을 매니페스트 한 줄을 만들어 준다.

const PREVIEW_LOADOUT: Loadout = {
  armL: 'autocannon',
  armR: 'railgun',
  shoulder: 'missile',
  shoulder2: 'flak',
  core: 'shield_gen',
};
const ROLES: [ModelKey, string][] = [
  ['robot', '로봇'],
  ['drone', '드론'],
  ['tank', '탱크'],
  ['shielder', '실드'],
  ['flyer', '비행'],
  ['bomber', '자폭'],
  ['regen', '재생'],
  ['boss', '보스'],
];

const state = {
  files: [] as string[],
  file: '',
  role: 'robot' as ModelKey,
  rotationY: 0,
  weapons: true,
  mountBone: 'Chest',
  arm: { x: 1.3, y: 1.9, z: 0.3 },
  clip: '',
};

// ─── 장면 ────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10151d);
scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x20242c, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(6, 10, 8);
sun.castShadow = true;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x1d242e }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.GridHelper(20, 20, 0x3a4a5c, 0x2a3440));

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
camera.position.set(4, 4, 8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.4, 0);

// 비교용: 게임의 기본(절차적) 로봇
const reference = buildRobot('classic');
reference.setLoadout({ armL: null, armR: null, shoulder: null, shoulder2: null, core: null });
reference.group.position.set(-4, 0, 0);
scene.add(reference.group);

// 정면(+z) 표시 화살표
scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.05, 0), 2.5, 0x5ce1ff, 0.4, 0.25));

let current: { group: THREE.Object3D; inst: ModelInstance } | null = null;
let fitBox: THREE.Box3Helper | null = null;
const loader = new GLTFLoader();
const gltfCache = new Map<string, GLTF>();
const clock = new THREE.Clock();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  current?.inst.mixer?.update(dt);
  controls.update();
  renderer.render(scene, camera);
});

// ─── 모델 구성 ───────────────────────────────────────

function currentAsset(): ModelAsset {
  const asset: ModelAsset = { url: state.file };
  if (state.rotationY) asset.rotationY = state.rotationY;
  if (state.role === 'robot' && state.weapons) {
    if (state.mountBone) asset.mountBone = state.mountBone;
    const { x, y, z } = state.arm;
    asset.mounts = { armL: [-x, y, z], armR: [x, y, z] };
  }
  return asset;
}

async function loadGltf(path: string): Promise<GLTF | null> {
  if (gltfCache.has(path)) return gltfCache.get(path)!;
  const buf = await fetchBinary(path);
  if (!buf) return null;
  const base = import.meta.env.BASE_URL + path.substring(0, path.lastIndexOf('/') + 1);
  const gltf = await loader.parseAsync(buf, base);
  gltfCache.set(path, gltf);
  return gltf;
}

async function rebuild(): Promise<void> {
  if (current) scene.remove(current.group);
  if (fitBox) scene.remove(fitBox);
  current = null;
  if (!state.file) return renderPanel();
  const gltf = await loadGltf(state.file);
  if (!gltf) {
    renderPanel(`불러오기 실패: ${state.file}`);
    return;
  }
  const asset = currentAsset();
  const inst = createInstance(gltf.scene, gltf.animations, asset, state.role);
  let group: THREE.Object3D = inst.root;
  if (state.role === 'robot' && state.weapons) {
    const robot = buildModelRobot(inst, asset);
    robot.setLoadout(PREVIEW_LOADOUT);
    group = robot.group;
  }
  scene.add(group);
  current = { group, inst };

  // 종류별 목표 크기 상자 (게임에서 이 상자 안에 맞춰진다)
  const fit = FIT[state.role];
  fitBox = new THREE.Box3Helper(
    new THREE.Box3(new THREE.Vector3(-fit.width / 2, fit.baseY, -fit.width / 2), new THREE.Vector3(fit.width / 2, fit.baseY + fit.height, fit.width / 2)),
    0xff8a3d,
  );
  scene.add(fitBox);

  if (state.clip && inst.mixer) playClip(state.clip);
  renderPanel();
}

function playClip(name: string): void {
  if (!current?.inst.mixer) return;
  const gltf = gltfCache.get(state.file);
  const clip = gltf?.animations.find((c) => c.name === name);
  if (!clip) return;
  current.inst.mixer.stopAllAction();
  current.inst.mixer.clipAction(clip).reset().setEffectiveWeight(1).play();
  state.clip = name;
}

// ─── 패널 ────────────────────────────────────────────

const panel = document.getElementById('panel')!;

function manifestLine(): string {
  const a = currentAsset();
  const parts = [`url: '${a.url}'`];
  if (a.rotationY) parts.push(`rotationY: ${rotationLabel(a.rotationY)}`);
  if (a.mountBone) parts.push(`mountBone: '${a.mountBone}'`);
  if (a.mounts) parts.push(`mounts: { armL: [${a.mounts.armL!.join(', ')}], armR: [${a.mounts.armR!.join(', ')}] }`);
  return `${state.role}: { ${parts.join(', ')} },`;
}

function rotationLabel(r: number): string {
  const deg = Math.round((r * 180) / Math.PI);
  return deg === 180 ? 'Math.PI' : deg === 90 ? 'Math.PI / 2' : deg === 270 ? '-Math.PI / 2' : String(r);
}

function renderPanel(error = ''): void {
  const gltf = gltfCache.get(state.file);
  const clips = gltf?.animations.map((c) => c.name) ?? [];
  const bones: string[] = [];
  gltf?.scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o.name);
  });
  const size = current ? current.inst.size : null;

  panel.innerHTML = `
    <h1>모델 뷰어</h1>
    <p class="hint">주황 상자 = 게임에서 맞춰질 크기, 파란 화살표 = 정면(+z). 왼쪽 회색 로봇은 기본 로봇(비교용).</p>
    <section>
      <h2>파일</h2>
      <div class="files">${state.files
        .map((f) => `<button data-file="${f}" class="${f === state.file ? 'on' : ''}">${f.replace(/^models\//, '')}</button>`)
        .join('')}</div>
    </section>
    <section>
      <h2>용도</h2>
      <div class="row wrap">${ROLES.map(([k, l]) => `<button data-role="${k}" class="${k === state.role ? 'on' : ''}">${l}</button>`).join('')}</div>
      <h2>정면 보정 (rotationY)</h2>
      <div class="row">${[0, 90, 180, 270]
        .map((d) => `<button data-rot="${d}" class="${Math.round((state.rotationY * 180) / Math.PI) === d ? 'on' : ''}">${d}°</button>`)
        .join('')}</div>
    </section>
    ${
      state.role === 'robot'
        ? `<section>
      <h2>무기 장착</h2>
      <label><input type="checkbox" data-weapons ${state.weapons ? 'checked' : ''}/> 무기 미리보기</label>
      <label>뼈대 <input data-bone value="${state.mountBone}" list="bones" /></label>
      <datalist id="bones">${bones.map((b) => `<option value="${b}">`).join('')}</datalist>
      ${(['x', 'y', 'z'] as const)
        .map(
          (axis) => `<label class="slider">팔 ${axis === 'x' ? '좌우' : axis === 'y' ? '높이' : '앞뒤'}
        <input type="range" data-arm="${axis}" min="${axis === 'y' ? 0 : -2}" max="${axis === 'y' ? 3.5 : 3}" step="0.05" value="${state.arm[axis]}" />
        <span>${state.arm[axis].toFixed(2)}</span></label>`,
        )
        .join('')}
    </section>`
        : ''
    }
    <section>
      <h2>애니메이션 (${clips.length})</h2>
      <div class="row wrap">${clips.map((c) => `<button data-clip="${c}" class="${c === state.clip ? 'on' : ''}">${c}</button>`).join('') || '<span class="hint">없음</span>'}</div>
    </section>
    <section>
      <h2>정보</h2>
      <p class="hint">${size ? `맞춘 크기: 폭 ${size.x.toFixed(2)} · 높이 ${size.y.toFixed(2)} · 깊이 ${size.z.toFixed(2)}` : ''}</p>
      <p class="hint">뼈대: ${bones.join(', ') || '없음'}</p>
      <h2>매니페스트 (src/data/assets.ts)</h2>
      <pre>${state.file ? manifestLine() : ''}</pre>
      ${error ? `<p class="error">${error}</p>` : ''}
    </section>`;

  panel.querySelectorAll<HTMLElement>('[data-file]').forEach((b) =>
    b.addEventListener('click', () => {
      state.file = b.dataset.file!;
      state.clip = '';
      void rebuild();
    }),
  );
  panel.querySelectorAll<HTMLElement>('[data-role]').forEach((b) =>
    b.addEventListener('click', () => {
      state.role = b.dataset.role as ModelKey;
      void rebuild();
    }),
  );
  panel.querySelectorAll<HTMLElement>('[data-rot]').forEach((b) =>
    b.addEventListener('click', () => {
      state.rotationY = (Number(b.dataset.rot) * Math.PI) / 180;
      void rebuild();
    }),
  );
  panel.querySelectorAll<HTMLElement>('[data-clip]').forEach((b) =>
    b.addEventListener('click', () => {
      playClip(b.dataset.clip!);
      renderPanel();
    }),
  );
  panel.querySelector<HTMLInputElement>('[data-weapons]')?.addEventListener('change', (e) => {
    state.weapons = (e.target as HTMLInputElement).checked;
    void rebuild();
  });
  panel.querySelector<HTMLInputElement>('[data-bone]')?.addEventListener('change', (e) => {
    state.mountBone = (e.target as HTMLInputElement).value.trim();
    void rebuild();
  });
  panel.querySelectorAll<HTMLInputElement>('[data-arm]').forEach((input) =>
    input.addEventListener('change', () => {
      state.arm[input.dataset.arm as 'x' | 'y' | 'z'] = Number(input.value);
      void rebuild();
    }),
  );
}

const style = document.createElement('style');
style.textContent = `
  body { margin: 0; overflow: hidden; background: #10151d; font: 13px 'Malgun Gothic', system-ui, sans-serif; color: #dce6f2; }
  #panel { position: fixed; top: 0; left: 0; bottom: 0; width: 340px; overflow-y: auto; padding: 12px 14px;
    background: rgba(13, 18, 27, 0.92); border-right: 1px solid #273447; box-sizing: border-box; }
  h1 { font-size: 16px; margin: 0 0 4px; } h2 { font-size: 12px; color: #8494a8; margin: 12px 0 6px; font-weight: 600; }
  .hint { color: #8494a8; margin: 2px 0; line-height: 1.5; word-break: break-all; }
  .files { display: flex; flex-direction: column; gap: 3px; max-height: 240px; overflow-y: auto; }
  .row { display: flex; gap: 4px; } .wrap { flex-wrap: wrap; }
  button { font: inherit; color: inherit; background: #1c2635; border: 1px solid #273447; border-radius: 6px; padding: 4px 8px; cursor: pointer; text-align: left; }
  button.on { border-color: #ff8a3d; color: #ff8a3d; }
  label { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
  .slider input { flex: 1; } input[data-bone] { flex: 1; background: #121925; color: inherit; border: 1px solid #273447; padding: 3px 6px; }
  pre { background: #0a0e14; border: 1px solid #273447; padding: 8px; white-space: pre-wrap; word-break: break-all; user-select: all; }
  .error { color: #f05454; }`;
document.head.appendChild(style);

async function init(): Promise<void> {
  try {
    state.files = (await (await fetch('/__models')).json()) as string[];
  } catch {
    renderPanel('파일 목록을 가져오지 못했습니다. vite.config.ts가 추가되었으니 개발 서버를 재시작하세요.');
    return;
  }
  renderPanel();
}

void init();
