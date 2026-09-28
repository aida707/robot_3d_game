import type { SoundName } from '../audio/sfx';
import type { SlotId } from '../game/types';

// 외부 에셋 매니페스트. 비어 있는 항목은 절차적 모델 / 합성음 / 절차적 BGM으로 대체된다.
// 파일은 public/ 아래에 두고, 경로는 public/ 기준 상대 경로로 적는다.
// 모델은 로딩 시 종류별 목표 크기에 맞춰 자동으로 축척·정렬된다 (src/engine/assets.ts의 FIT).

export type ModelKey = 'robot' | 'drone' | 'tank' | 'shielder' | 'flyer' | 'bomber' | 'regen' | 'boss' | 'juggernaut';

export interface ModelAsset {
  url: string;
  /** 모델 정면이 +z가 아니면 보정 (라디안, 예: Math.PI) */
  rotationY?: number;
  /** 애니메이션 클립 이름. 생략하면 이름으로 추정한다 (idle / walk·run) */
  idleClip?: string;
  walkClip?: string;
  /** (로봇 전용) 무기를 붙일 뼈대 이름. 지정하면 무기가 그 뼈대를 따라 움직인다 (예: 'Chest') */
  mountBone?: string;
  /** (로봇 전용) 슬롯별 장착 위치 [x, y, z]. 게임 단위, 로봇 발밑 기준, +z가 정면. 생략하면 크기 비율로 추정 */
  mounts?: Partial<Record<SlotId, [number, number, number]>>;
  /** (로봇 전용) 상체 회전에 쓸 뼈대. 다리와 따로 조준 방향으로 돌린다 (예: 'Torso') */
  torsoBone?: string;
}

/**
 * 플레이어 로봇 디자인 (격납고에서 고른다). 모두 스탯은 같고 겉모습만 다르다.
 * asset이 null이면 절차적으로 그린 기본 로봇.
 * Mech 4종(Quaternius Animated Mech Pack, CC0)은 뼈대가 같아 무기를 몸통(Chest) 양옆 포 위에 얹는다.
 * 장착 위치는 모델 크기 비율로 정해진다 (models.ts buildModelRobot).
 */
export interface RobotSkin {
  id: string;
  name: string;
  asset: ModelAsset | null;
}

const mech = (file: string): ModelAsset => ({ url: `models/${file}`, mountBone: 'Chest', torsoBone: 'Torso' });

export const ROBOT_SKINS: RobotSkin[] = [
  { id: 'rae', name: '레드판다', asset: mech('Mech_RaeTheRedPanda.gltf') },
  { id: 'barbara', name: '꿀벌', asset: mech('Mech_BarbaraTheBee.gltf') },
  { id: 'fernando', name: '플라밍고', asset: mech('Mech_FernandoTheFlamingo.gltf') },
  { id: 'finn', name: '개구리', asset: mech('Mech_FinnTheFrog.gltf') },
  { id: 'classic', name: '클래식 (기본 로봇)', asset: null },
];

export const DEFAULT_SKIN = 'rae';

export const MODEL_ASSETS: Partial<Record<ModelKey, ModelAsset>> = {
  // 출처: Quaternius (CC0) — Sci-Fi Essentials Kit, Animated Tanks Pack
  drone: { url: 'models/drone/Enemy_EyeDrone.gltf' },
  tank: { url: 'models/tank/Tank.gltf' },
  shielder: { url: 'models/shielder/Enemy_QuadShell.gltf' },
  // 4단계 적: Ultimate Space Kit(우주선·로버), Sci-Fi Essentials Kit(Trilobite)
  flyer: { url: 'models/flyer/Spaceship_BarbaraTheBee.gltf' },
  bomber: { url: 'models/bomber/Rover_Round.gltf' },
  regen: { url: 'models/regen/Rover_2.gltf' },
  boss: { url: 'models/boss/Enemy_Trilobite.gltf' },
  // 5단계 적: Ultimate Space Kit
  juggernaut: { url: 'models/juggernaut/Rover_1.gltf' },
};

export interface SoundAsset {
  /** 여러 개면 재생할 때마다 무작위로 고른다 */
  files: string[];
  /** 재생 음량 (샘플은 합성음보다 훨씬 커서 낮춰 쓴다). 기본 1 */
  volume?: number;
  /** 이보다 길면 잘라서 페이드아웃한다 (초) */
  maxDuration?: number;
}

/** sfx/<이름>_000.ogg ~ sfx/<이름>_00(n-1).ogg */
const takes = (name: string, n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => `sfx/${name}_${String(from + i).padStart(3, '0')}.ogg`);

/**
 * 효과음 샘플: Kenney Sci-fi Sounds / Impact Sounds (CC0, 원본은 asset_backup/sounds).
 * 음량은 샘플의 최대 진폭(약 0.9)을 합성음 수준에 맞춰 낮춘 값이다.
 * 등록하지 않은 소리(기관포, 클릭, 구매, 승리·패배)는 합성음을 쓴다.
 */
export const SOUND_ASSETS: Partial<Record<SoundName, SoundAsset>> = {
  missile: { files: takes('thrusterFire', 3), volume: 0.2, maxDuration: 0.5 },
  flame: { files: takes('thrusterFire', 2, 3), volume: 0.12, maxDuration: 0.25 },
  rail: { files: takes('laserLarge', 5), volume: 0.45 },
  laser: { files: takes('laserSmall', 5), volume: 0.15 },
  explosion: { files: takes('explosionCrunch', 5), volume: 0.4, maxDuration: 0.9 },
  bigExplosion: { files: takes('lowFrequency_explosion', 2), volume: 0.7 },
  shieldHit: { files: takes('forceField', 5), volume: 0.1, maxDuration: 0.4 },
  enemyShot: { files: takes('laserRetro', 5), volume: 0.12 },
  hit: { files: takes('impactMetal_light', 5), volume: 0.12 },
  robotHit: { files: takes('impactMetal_heavy', 5), volume: 0.45 },
};

/** 배경음. 비어 있으면 절차적 BGM을 쓴다. */
export const MUSIC_ASSETS: { menu?: string; battle?: string } = {
  // battle: 'music/battle.ogg',
};
