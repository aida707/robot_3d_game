import * as THREE from 'three';
import { Battle } from '../game/Battle';
import { buildRobot } from '../engine/models';
import { STAGES } from '../data/stages';
import { buildBattleSetup, powerUsed, resolveRobot } from '../game/stats';
import { defaultSave } from '../game/save';
import type { Arena } from '../engine/Arena';
import type { Sfx } from '../audio/sfx';
import type { BattleResult, Loadout, SaveData } from '../game/types';

// 개발 서버 전용: 브라우저 콘솔에서 화면 없이 전투를 돌려 밸런스를 확인한다.
// 예) balance.simulate(3, { loadout: { armL: 'railgun', armR: 'railgun' } }, 5)
//     balance.simulate(5, { research: ['focus_lens'], weaponLevels: { laser: 3 }, loadout: { armL: 'laser', core: 'shield_gen' } })
// 결과: W78 = 승리(남은 체력 78%), L = 패배, T = 시간 초과, P!(13/12) = 전력 초과로 출격 불가

export type SimOptions = Partial<Omit<SaveData, 'loadout'>> & { loadout?: Partial<Loadout> };

const ARENA_RADIUS = 18;
const MAX_SECONDS = 240;

function runOnce(stageId: number, save: SaveData): BattleResult | null {
  const scene = new THREE.Scene();
  const arena = { scene, camera: new THREE.PerspectiveCamera(), radius: ARENA_RADIUS, addShake() {} } as unknown as Arena;
  const sfx = { play() {} } as unknown as Sfx;
  // 디자인은 성능과 무관하므로 가벼운 기본 로봇으로 돌린다
  const robot = buildRobot('classic');
  scene.add(robot.group);
  let result: BattleResult | null = null;
  const battle = new Battle(arena, robot, STAGES[stageId - 1], buildBattleSetup(save), sfx, {
    onHud() {},
    onEnd(r) {
      result = r;
    },
  });
  for (let i = 0; i < MAX_SECONDS * 60 && !result; i++) battle.update(1 / 60);
  battle.dispose();
  return result;
}

export function simulate(stageId: number, opts: SimOptions = {}, runs = 3): string {
  const base = defaultSave();
  const save: SaveData = {
    ...base,
    ...opts,
    loadout: { ...base.loadout, ...opts.loadout },
    chips: { ...base.chips, ...opts.chips },
  };
  // 게임에서 출격할 수 없는 조합(전력 초과)은 시뮬레이션하지 않는다
  const used = powerUsed(buildBattleSetup(save).loadout);
  const cap = resolveRobot(save).powerCapacity;
  if (used > cap) return `P!(${used}/${cap})`;
  const out: string[] = [];
  for (let i = 0; i < runs; i++) {
    const r = runOnce(stageId, save);
    out.push(!r ? 'T' : r.victory ? `W${Math.round(r.hpRatio * 100)}` : 'L');
  }
  return out.join(' ');
}

declare global {
  interface Window {
    balance: { simulate: typeof simulate };
  }
}

window.balance = { simulate };
