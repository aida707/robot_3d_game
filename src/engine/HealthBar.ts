import * as THREE from 'three';

const BG_GEO = new THREE.PlaneGeometry(1, 1);
// 왼쪽 끝 기준으로 늘어나도록 원점을 옮긴 막대
const FG_GEO = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
const BAR_H = 0.12;

function barMat(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
}

/** 적 머리 위 체력/실드 막대. 매 프레임 카메라를 향하도록 회전시킨다. */
export class HealthBar {
  readonly group = new THREE.Group();
  private hpFg: THREE.Mesh;
  private hpMat = barMat(0x5be37a);
  private shieldFg: THREE.Mesh | null = null;
  private mats: THREE.Material[] = [];

  constructor(private width: number, hasShield: boolean) {
    const rows = hasShield ? 2 : 1;
    const bgMat = barMat(0x000000, 0.6);
    const bg = new THREE.Mesh(BG_GEO, bgMat);
    bg.scale.set(width + 0.06, BAR_H * rows + 0.06 + (rows - 1) * 0.03, 1);
    bg.position.y = ((rows - 1) * (BAR_H + 0.03)) / 2;
    this.group.add(bg);

    this.hpFg = new THREE.Mesh(FG_GEO, this.hpMat);
    this.hpFg.position.x = -width / 2;
    this.hpFg.scale.set(width, BAR_H, 1);
    this.group.add(this.hpFg);
    this.mats.push(bgMat, this.hpMat);

    if (hasShield) {
      const shieldMat = barMat(0x5cc8ff);
      this.shieldFg = new THREE.Mesh(FG_GEO, shieldMat);
      this.shieldFg.position.set(-width / 2, BAR_H + 0.03, 0);
      this.shieldFg.scale.set(width, BAR_H, 1);
      this.group.add(this.shieldFg);
      this.mats.push(shieldMat);
    }
    this.group.traverse((o) => (o.renderOrder = 999));
  }

  set(hpRatio: number, shieldRatio: number): void {
    const hp = Math.max(0, Math.min(1, hpRatio));
    this.hpFg.scale.x = Math.max(0.001, this.width * hp);
    this.hpMat.color.setHex(hp > 0.5 ? 0x5be37a : hp > 0.25 ? 0xf5c542 : 0xf05454);
    if (this.shieldFg) this.shieldFg.scale.x = Math.max(0.001, this.width * Math.max(0, Math.min(1, shieldRatio)));
  }

  dispose(): void {
    this.mats.forEach((m) => m.dispose());
  }
}
