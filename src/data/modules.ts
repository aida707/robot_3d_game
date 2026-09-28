import type { ModuleDef } from '../game/types';

export const MODULES: ModuleDef[] = [
  {
    id: 'aux_reactor',
    name: '보조 원자로',
    desc: '전력 용량을 3 늘린다. 방어 대신 화력에 전부 투자하는 선택.',
    power: 0,
    cost: 500,
    research: null,
    color: 0xffb347,
    powerBonus: 3,
  },
  {
    id: 'shield_gen',
    name: '실드 발생기',
    desc: '기체에 실드 150을 두른다. 2초 동안 피격이 없으면 초당 25씩 재생한다.',
    power: 2,
    cost: 700,
    research: 'shield_tech',
    color: 0x4fb3ff,
    shield: 150,
    shieldRegen: 25,
  },
  {
    id: 'nano_repair',
    name: '수리 나노봇',
    desc: '전투 중 초당 체력 5를 계속 회복한다. 긴 전투에서 빛을 본다.',
    power: 2,
    cost: 600,
    research: 'nanobots',
    color: 0x5be37a,
    repair: 5,
  },
];

export const MODULE_MAP: Record<string, ModuleDef> = Object.fromEntries(MODULES.map((m) => [m.id, m]));
