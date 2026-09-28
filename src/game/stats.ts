import { ROBOT, SLOTS } from '../data/robot';
import { WEAPON_MAP } from '../data/weapons';
import { MODULE_MAP } from '../data/modules';
import type { BattleSetup, Loadout, RobotStats, SaveData, SlotDef, SlotId, WeaponDef } from './types';

// 강화 레벨·연구·코어 모듈을 반영한 최종 스탯 계산. 밸런스 공식은 여기에 모은다.

export const MAX_WEAPON_LEVEL = 5;
const DAMAGE_PER_LEVEL = 0.1;
const FIRE_RATE_PER_LEVEL = 0.05;

export function weaponLevel(save: SaveData, id: string): number {
  return save.weaponLevels[id] ?? 1;
}

/**
 * 강화 단계별 비용 배율 (Lv1→2, 2→3, 3→4, 4→5).
 * 뒤로 갈수록 가팔라서 첫 클리어 보상만으로는 모든 무기를 Lv5로 만들 수 없다.
 * 주력 무기를 골라 키우거나, 이미 깬 스테이지를 재도전해 크레딧을 모아야 한다.
 */
const UPGRADE_STEP_MULT = [1, 2, 5, 8];

/** level → level+1 강화 비용. 최대 레벨이면 null */
export function upgradeCost(def: WeaponDef, level: number): number | null {
  if (level >= MAX_WEAPON_LEVEL) return null;
  return Math.round(((150 + def.cost * 0.35) * UPGRADE_STEP_MULT[level - 1]) / 10) * 10;
}

export function resolveWeapon(save: SaveData, id: string): WeaponDef {
  const base = WEAPON_MAP[id];
  const lv = weaponLevel(save, id);
  const has = (r: string) => save.research.includes(r);
  const w: WeaponDef = { ...base, tags: [...base.tags] };

  w.damage = base.damage * (1 + DAMAGE_PER_LEVEL * (lv - 1));
  w.fireRate = base.fireRate * (1 + FIRE_RATE_PER_LEVEL * (lv - 1));

  if (w.damageType === 'kinetic') {
    if (has('ap_rounds')) w.pierce = Math.min(1, w.pierce + 0.25);
    if (has('rapid_feed')) w.fireRate *= 1.2;
  }
  if (w.damageType === 'explosive' && has('he_warhead')) {
    w.aoeRadius *= 1.3;
    w.damage *= 1.1;
  }
  // 다탄두는 어깨 미사일 포드 전용 (로켓 런처는 일제 사격이라 +2발이면 너무 강하다)
  if (w.fireMode === 'missile' && !w.salvo && has('cluster')) w.burst += 2;
  if (w.damageType === 'energy' && has('focus_lens')) {
    w.damage *= 1.25;
    w.range += 2;
  }
  if (w.targets === 'air' && has('proximity')) {
    w.damage *= 1.3;
    w.aoeRadius *= 1.3;
  }
  if (base.lineShot) {
    w.lineShot = { ...base.lineShot };
    if (has('gauss_capacitor')) {
      w.fireRate *= 1.25;
      w.lineShot.falloff = 0;
    }
  }
  if (base.stun && has('emp_amplifier')) {
    w.aoeRadius *= 1.3;
    w.range *= 1.3;
    w.stun = base.stun + 0.5;
  }
  if (base.burn) {
    w.burn = { ...base.burn };
    if (has('napalm')) {
      w.burn.dps *= 1.75;
      w.burn.duration += 1;
    }
  }
  return w;
}

/** 연구로 열리는 슬롯(어깨 2)을 쓸 수 있는지 */
export function slotUnlocked(save: SaveData, slot: SlotDef): boolean {
  return !slot.research || save.research.includes(slot.research);
}

export function resolveRobot(save: SaveData): RobotStats {
  const has = (r: string) => save.research.includes(r);
  const s: RobotStats = {
    maxHp: ROBOT.maxHp,
    powerCapacity: ROBOT.powerCapacity,
    speed: ROBOT.speed,
    shield: 0,
    shieldRegen: 0,
    repair: 0,
  };
  if (has('armor_plating')) s.maxHp += 100;
  if (has('reactor')) s.powerCapacity += 2;
  if (has('reactor2')) s.powerCapacity += 3;
  if (has('reactor3')) s.powerCapacity += 3;

  const core = save.loadout.core ? MODULE_MAP[save.loadout.core] : null;
  if (core) {
    s.powerCapacity += core.powerBonus ?? 0;
    s.shield += core.shield ?? 0;
    s.shieldRegen += core.shieldRegen ?? 0;
    s.repair += core.repair ?? 0;
  }
  return s;
}

/** 슬롯에 장착된 무기 또는 모듈의 전력 소모 */
export function itemPower(slot: SlotId, id: string | null): number {
  if (!id) return 0;
  return slot === 'core' ? MODULE_MAP[id].power : WEAPON_MAP[id].power;
}

export function powerUsed(loadout: Loadout): number {
  return SLOTS.reduce((sum, slot) => sum + itemPower(slot.id, loadout[slot.id]), 0);
}

export function hasAnyWeapon(loadout: Loadout): boolean {
  return SLOTS.some((slot) => slot.type !== 'core' && loadout[slot.id]);
}

export function buildBattleSetup(save: SaveData): BattleSetup {
  const weapons: BattleSetup['weapons'] = {};
  const loadout = { ...save.loadout };
  for (const slot of SLOTS) {
    if (!slotUnlocked(save, slot)) {
      loadout[slot.id] = null;
      continue;
    }
    const id = loadout[slot.id];
    if (slot.type !== 'core' && id) weapons[slot.id] = resolveWeapon(save, id);
  }
  return {
    loadout,
    weapons,
    robot: resolveRobot(save),
    chips: { ...save.chips },
  };
}
