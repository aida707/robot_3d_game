import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export type ViewMode = 'hangar' | 'battle' | 'follow' | 'victory';

/** relative: 추적 대상의 위치를 기준으로 한 시점 */
const VIEWS: Record<ViewMode, { pos: THREE.Vector3; look: THREE.Vector3; relative: boolean }> = {
  hangar: { pos: new THREE.Vector3(0, 3.2, 7.5), look: new THREE.Vector3(0, 1.7, 0), relative: false },
  battle: { pos: new THREE.Vector3(0, 27, 21), look: new THREE.Vector3(0, 0, 2.5), relative: false },
  follow: { pos: new THREE.Vector3(0, 12, 10), look: new THREE.Vector3(0, 1, 0.5), relative: true },
  // 결과 패널이 화면 가운데를 가리므로 로봇이 오른쪽에 오도록 시선을 왼쪽으로 비킨다
  victory: { pos: new THREE.Vector3(0.5, 3.4, 8), look: new THREE.Vector3(-2.6, 2.2, 0), relative: true },
};

const MIN_POLAR = 0.12;
const MAX_POLAR = 1.45;

/** 렌더러, 씬, 카메라, 경기장 환경을 관리한다. 게임 로직은 onUpdate로 주입된다. */
export class Arena {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly radius = 18;
  /** 캔버스 위, UI 아래에 놓이는 DOM 레이어 (피해 숫자 등) */
  readonly overlay: HTMLElement;
  onUpdate: ((dt: number) => void) | null = null;

  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private clock = new THREE.Clock();
  private shake = 0;
  private view: ViewMode = 'hangar';
  private target: THREE.Object3D | null = null;
  /** 마우스로 조작한 시점 보정값 */
  private orbit = { yaw: 0, pitch: 0, zoom: 1 };
  /** 화면에 닿아 있는 포인터(마우스·손가락)들의 현재 위치 */
  private pointers = new Map<number, { x: number; y: number }>();
  /** 두 손가락 확대·축소의 직전 손가락 간 거리 */
  private pinchDistance = 0;
  private camPos = VIEWS.hangar.pos.clone();
  private camLook = VIEWS.hangar.look.clone();

  constructor(container: HTMLElement) {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.overlay = document.createElement('div');
    this.overlay.className = 'arena-overlay';
    container.appendChild(this.overlay);
    this.bindMouse();

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 250);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.4, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildEnvironment();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** 시점을 바꾼다. follow / victory 시점은 target을 따라간다. 마우스 보정값은 초기화된다. */
  setView(mode: ViewMode, target: THREE.Object3D | null = null): void {
    this.view = mode;
    this.target = target;
    this.resetOrbit();
  }

  get viewMode(): ViewMode {
    return this.view;
  }

  resetOrbit(): void {
    this.orbit = { yaw: 0, pitch: 0, zoom: 1 };
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  /**
   * 마우스·터치 시점 조작.
   * - 포인터 하나(마우스 드래그 / 손가락 하나): 회전
   * - 손가락 둘: 두 손가락 사이 거리 변화로 확대·축소 (마우스 휠과 같은 범위)
   * - 휠: 확대·축소, 더블클릭(더블탭): 초기화
   */
  private bindMouse(): void {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    const pointers = this.pointers;
    const distance = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // 합성 이벤트 등 캡처할 수 없는 포인터는 무시
      }
      if (pointers.size === 2) this.pinchDistance = distance();
    });
    el.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        // 두 손가락: 벌리면 확대(카메라가 가까워짐), 오므리면 축소
        const d = distance();
        if (this.pinchDistance > 0 && d > 0) this.setZoom(this.orbit.zoom * (this.pinchDistance / d));
        this.pinchDistance = d;
        return;
      }
      this.orbit.yaw -= (e.clientX - prev.x) * 0.006;
      this.orbit.pitch += (e.clientY - prev.y) * 0.004;
    });
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      // 한 손가락을 떼도 남은 손가락으로 바로 회전이 튀지 않도록 기준 거리만 갱신
      this.pinchDistance = pointers.size >= 2 ? distance() : 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.setZoom(this.orbit.zoom * Math.exp(e.deltaY * 0.001));
      },
      { passive: false },
    );
    el.addEventListener('dblclick', () => this.resetOrbit());
  }

  private setZoom(zoom: number): void {
    this.orbit.zoom = THREE.MathUtils.clamp(zoom, 0.45, 1.8);
  }

  private viewGoal(): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const v = VIEWS[this.view];
    const look = v.look.clone();
    if (v.relative && this.target) look.add(this.target.position);

    // 세로 화면에서는 경기장이 잘리지 않도록 카메라를 뒤로 뺀다
    const aspect = this.camera.aspect;
    const factor = aspect < 1.4 ? Math.min(2.2, 1.4 / aspect) : 1;

    // 기본 시점 오프셋을 구면 좌표로 바꿔 마우스 회전·확대를 적용한다
    const sph = new THREE.Spherical().setFromVector3(v.pos.clone().sub(v.look));
    sph.theta += this.orbit.yaw;
    const polar = THREE.MathUtils.clamp(sph.phi - this.orbit.pitch, MIN_POLAR, MAX_POLAR);
    // 한계에 닿으면 pitch 보정값도 멈춰서, 반대로 드래그할 때 바로 반응하게 한다
    this.orbit.pitch = sph.phi - polar;
    sph.phi = polar;
    sph.radius *= factor * this.orbit.zoom;
    return { pos: look.clone().add(new THREE.Vector3().setFromSpherical(sph)), look };
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.onUpdate?.(dt);

    const goal = this.viewGoal();
    const k = 1 - Math.exp(-dt * 3);
    this.camPos.lerp(goal.pos, k);
    this.camLook.lerp(goal.look, k);

    this.shake = Math.max(0, this.shake - dt * 2.5);
    const s = this.shake * this.shake * 0.6;
    this.camera.position.set(
      this.camPos.x + (Math.random() - 0.5) * s,
      this.camPos.y + (Math.random() - 0.5) * s,
      this.camPos.z + (Math.random() - 0.5) * s,
    );
    this.camera.lookAt(this.camLook);
    this.composer.render();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  private buildEnvironment(): void {
    const bg = 0x0b0f16;
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = new THREE.Fog(bg, 50, 120);

    this.scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x20242c, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(15, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 80;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(90, 64),
      new THREE.MeshStandardMaterial({ color: 0x161b22, roughness: 0.95, metalness: 0.1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius, 64),
      new THREE.MeshStandardMaterial({ color: 0x222a34, roughness: 0.85, metalness: 0.2 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.01;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(this.radius * 2, 24, 0x3a4a5c, 0x2a3440);
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.45;
    grid.position.y = 0.02;
    this.scene.add(grid);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(this.radius, 0.12, 8, 128),
      new THREE.MeshStandardMaterial({ color: 0x331a0a, emissive: 0xff8a3d, emissiveIntensity: 2 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    this.scene.add(ring);

    // 경기장 밖 장식 기둥
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2a313b, roughness: 0.7, metalness: 0.4 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x0a2530, emissive: 0x33ddff, emissiveIntensity: 1.5 });
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.2;
      const r = this.radius + 6 + Math.random() * 8;
      const height = 3 + Math.random() * 7;
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.6, height, 1.6), pillarMat);
      pillar.position.set(Math.cos(angle) * r, height / 2, Math.sin(angle) * r);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.scene.add(pillar);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.15, 1.65), stripeMat);
      stripe.position.set(pillar.position.x, height - 0.5, pillar.position.z);
      this.scene.add(stripe);
    }
  }
}
