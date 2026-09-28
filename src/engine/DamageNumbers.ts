import * as THREE from 'three';

/**
 * normal: 일반 피해 / weak: 장갑·상성에 막혀 효율이 낮은 피해 / shield: 실드에만 들어간 피해
 * big: 큰 한 방 / player: 로봇이 받은 피해
 */
export type NumberKind = 'normal' | 'weak' | 'shield' | 'big' | 'player';

interface Item {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  life: number;
}

const LIFE = 0.9;
const MAX_ITEMS = 60;

/** 3D 위치에 떠오르는 피해 숫자. 캔버스 위의 DOM 레이어에 그린다. */
export class DamageNumbers {
  /** 설정에서 끄고 켠다 */
  static enabled = true;

  private layer: HTMLDivElement;
  private items: Item[] = [];
  private pool: HTMLDivElement[] = [];
  private v = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'dmg-layer';
    container.appendChild(this.layer);
  }

  spawn(pos: THREE.Vector3, value: number, kind: NumberKind): void {
    if (!DamageNumbers.enabled || value < 0.5) return;
    if (this.items.length >= MAX_ITEMS) this.recycle(this.items.shift()!);
    const el = this.pool.pop() ?? document.createElement('div');
    el.className = `dmg ${kind}`;
    el.textContent = kind === 'weak' ? `${Math.round(value)}▼` : String(Math.round(value));
    this.layer.appendChild(el);
    this.items.push({
      el,
      pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)),
      life: LIFE,
    });
  }

  tick(dt: number): void {
    const alive: Item[] = [];
    for (const it of this.items) {
      it.life -= dt;
      it.pos.y += dt * 1.6;
      if (it.life <= 0) this.recycle(it);
      else alive.push(it);
    }
    this.items = alive;
  }

  render(camera: THREE.Camera, width: number, height: number): void {
    for (const it of this.items) {
      this.v.copy(it.pos).project(camera);
      if (this.v.z > 1) {
        it.el.style.opacity = '0';
        continue;
      }
      const x = ((this.v.x + 1) / 2) * width;
      const y = ((1 - this.v.y) / 2) * height;
      const t = it.life / LIFE;
      // 처음엔 살짝 커졌다가 줄어들며 사라진다
      const scale = t > 0.8 ? 1 + (t - 0.8) * 2 : 1;
      it.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`;
      it.el.style.opacity = String(Math.min(1, t * 2.5));
    }
  }

  clear(): void {
    this.items.forEach((it) => this.recycle(it));
    this.items = [];
    this.layer.remove();
  }

  private recycle(it: Item): void {
    it.el.remove();
    this.pool.push(it.el);
  }
}
