export type DamageType = 'kinetic' | 'explosive' | 'energy' | 'thermal';
export type SlotType = 'arm' | 'shoulder' | 'core';
export type SlotId = 'armL' | 'armR' | 'shoulder' | 'shoulder2' | 'core';
export type TargetChip = 'nearest' | 'strongest' | 'weakest' | 'shielded';
export type MoveChip = 'kite' | 'charge' | 'hold';
export type FireMode = 'bullet' | 'missile' | 'rail' | 'beam' | 'mortar' | 'flame' | 'flak' | 'gauss' | 'emp';
/** 무기가 조준할 수 있는 대상: 지상 / 공중 / 둘 다 */
export type TargetLayer = 'both' | 'ground' | 'air';

export interface WeaponDef {
  /** 구매 전에 필요한 연구 id */
  research?: string;
  targets: TargetLayer;
  /** 전방위 무기: 로봇이 바라보는 방향과 상관없이 쏜다 (기본은 전방 120°만) */
  omni?: boolean;
  /** 일제 사격: burst 발을 모두 조준한 한 적에게 쏜다 (로켓 런처). 없으면 미사일은 서로 다른 적에게 한 발씩 */
  salvo?: boolean;
  /** 이보다 가까운 적은 조준하지 못한다 (박격포) */
  minRange?: number;
  /** 부채꼴 공격 각도(도). 화염방사기 */
  coneAngle?: number;
  /** 명중 시 화상: 장갑·실드를 무시하는 지속 피해이며, 타는 동안 적의 체력 재생이 멈춘다 */
  burn?: { dps: number; duration: number };
  /** 일직선 관통: 사거리 끝까지 선 위의 적을 모두 맞힌다. 뒤로 갈수록 피해가 falloff만큼 줄어든다 (가우스 캐논) */
  lineShot?: { width: number; falloff: number };
  /** 기절(초): 이동·공격·실드 재생이 멈춘다. 보스는 절반만 걸린다 (EMP) */
  stun?: number;
  id: string;
  name: string;
  desc: string;
  slot: SlotType;
  damageType: DamageType;
  fireMode: FireMode;
  damage: number;
  /** 초당 발사(트리거) 횟수 */
  fireRate: number;
  /** 한 번 발사할 때 나가는 탄 수 (미사일 포드 등) */
  burst: number;
  range: number;
  /** 장갑 관통률 0~1 */
  pierce: number;
  aoeRadius: number;
  projectileSpeed: number;
  power: number;
  cost: number;
  tags: string[];
  color: number;
}

export interface EnemyDef {
  id: string;
  name: string;
  desc: string;
  model: 'drone' | 'tank' | 'shielder' | 'flyer' | 'bomber' | 'regen' | 'boss' | 'juggernaut';
  /** 강화형 (금색 테두리 장식) */
  elite?: boolean;
  /** 공중 유닛: 지상 전용 무기로는 맞힐 수 없다 */
  flying?: boolean;
  /** 초당 체력 재생 (화상 중에는 멈춘다) */
  hpRegen?: number;
  /** 로봇에 닿으면 자폭한다 */
  explode?: { damage: number; radius: number };
  /** 일정 간격으로 부하를 불러낸다 */
  summon?: { enemy: string; count: number; interval: number };
  boss?: boolean;
  hp: number;
  armor: number;
  shield: number;
  shieldRegen: number;
  speed: number;
  radius: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  ranged: boolean;
  tags: string[];
  color: number;
}

export interface WaveDef {
  enemy: string;
  count: number;
  /** 전투 시작 후 첫 스폰 시각(초) */
  start: number;
  /** 스폰 간격(초) */
  interval: number;
  /** 등장 방향이 흩어지는 폭(라디안). 기본 1.2. 작으면 한 줄로 늘어서 온다 */
  spread?: number;
}

export interface StageDef {
  id: number;
  name: string;
  briefing: string;
  hint: string;
  reward: number;
  waves: WaveDef[];
  /** 적 체력·실드 배율 (후반 난이도 조절). 기본 1 */
  hpScale?: number;
}

export interface SlotDef {
  id: SlotId;
  type: SlotType;
  label: string;
  /** 이 슬롯을 여는 연구 id */
  research?: string;
}

export interface ModuleDef {
  id: string;
  name: string;
  desc: string;
  power: number;
  cost: number;
  /** 구매 전에 필요한 연구 id */
  research: string | null;
  color: number;
  powerBonus?: number;
  shield?: number;
  shieldRegen?: number;
  repair?: number;
}

export interface ResearchDef {
  id: string;
  branch: string;
  name: string;
  desc: string;
  cost: number;
  requires: string | null;
}

export interface ChipOption<T extends string> {
  id: T;
  name: string;
  desc: string;
  research: string | null;
}

export type Loadout = Record<SlotId, string | null>;

export interface SaveData {
  credits: number;
  /** 연구 포인트 */
  rp: number;
  /** 보유 무기 id */
  owned: string[];
  /** 보유 코어 모듈 id */
  modules: string[];
  /** 무기 id → 강화 레벨 (1~5) */
  weaponLevels: Record<string, number>;
  /** 완료한 연구 id */
  research: string[];
  loadout: Loadout;
  chips: { target: TargetChip; move: MoveChip };
  /** 스테이지 id → 최고 별점 */
  stars: Record<number, number>;
  settings: Settings;
  /** 로봇 디자인 id (src/data/assets.ts ROBOT_SKINS). 스탯에는 영향 없음 */
  robotSkin: string;
}

export interface Settings {
  muted: boolean;
  /** 0~1 */
  sfx: number;
  /** 0~1 */
  music: number;
  damageNumbers: boolean;
  /** 효과음 샘플 사용 (끄면 합성음) */
  sfxSamples: boolean;
  /** 상체만 조준 방향으로 돌리고 다리는 이동 방향을 향함 (연출 전용, 끄면 몸 전체가 회전) */
  torsoAim: boolean;
}

/** 강화·연구·모듈을 모두 반영한 로봇 전투 스탯 */
export interface RobotStats {
  maxHp: number;
  powerCapacity: number;
  speed: number;
  shield: number;
  shieldRegen: number;
  repair: number;
}

/** 전투 시작에 필요한 모든 것 (저장 데이터에서 계산) */
export interface BattleSetup {
  loadout: Loadout;
  /** 슬롯별로 강화·연구가 반영된 무기 */
  weapons: Partial<Record<SlotId, WeaponDef>>;
  robot: RobotStats;
  chips: { target: TargetChip; move: MoveChip };
}

export interface ChapterDef {
  id: number;
  name: string;
  /** 이 챕터에 속한 스테이지 id 범위 (포함) */
  from: number;
  to: number;
}

export interface BattleResult {
  victory: boolean;
  hpRatio: number;
  stars: number;
  time: number;
  kills: number;
  total: number;
}
