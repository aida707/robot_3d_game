import type { DamageType } from './types';

export interface Damageable {
  hp: number;
  shield: number;
}

const SHIELD_MULT: Record<DamageType, number> = {
  kinetic: 0.5,
  explosive: 0.5,
  energy: 2,
  thermal: 1,
};

export interface DamageDealt {
  shield: number;
  hp: number;
}

/**
 * 피해를 적용하고 실제로 깎인 실드/체력 양을 반환한다.
 * 1) 실드가 먼저 받는다 (속성 배율 적용, 넘친 피해는 체력으로)
 * 2) 체력 피해 = max(피해 - 장갑 × (1 - 관통률), 피해 × 0.1)
 */
export function applyDamage(
  target: Damageable,
  armor: number,
  amount: number,
  type: DamageType,
  pierce: number,
): DamageDealt {
  let remaining = amount;
  let shieldDealt = 0;

  if (target.shield > 0) {
    const shieldDamage = remaining * SHIELD_MULT[type];
    if (shieldDamage <= target.shield) {
      target.shield -= shieldDamage;
      return { shield: shieldDamage, hp: 0 };
    }
    // 실드를 깨고 남은 비율만큼 체력으로 넘어간다
    remaining *= 1 - target.shield / shieldDamage;
    shieldDealt = target.shield;
    target.shield = 0;
  }

  const effectiveArmor = armor * (1 - pierce);
  const hpDamage = Math.max(remaining - effectiveArmor, remaining * 0.1);
  target.hp -= hpDamage;
  return { shield: shieldDealt, hp: hpDamage };
}
