import { STAGES } from '../data/stages';
import { DEFAULT_SKIN } from '../data/assets';
import type { SaveData } from './types';

const KEY = 'mech-tactics-save-v1';

export function defaultSave(): SaveData {
  return {
    credits: 300,
    rp: 0,
    owned: ['autocannon'],
    modules: [],
    weaponLevels: {},
    research: [],
    loadout: { armL: 'autocannon', armR: 'autocannon', shoulder: null, shoulder2: null, core: null },
    chips: { target: 'nearest', move: 'kite' },
    stars: {},
    settings: { muted: false, sfx: 0.8, music: 0.5, damageNumbers: true, sfxSamples: true },
    robotSkin: DEFAULT_SKIN,
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SaveData> & { muted?: boolean };
      const base = defaultSave();
      // 예전 버전 저장 데이터에 없는 필드는 기본값으로 채운다
      const { muted, ...rest } = parsed;
      return {
        ...base,
        ...rest,
        loadout: { ...base.loadout, ...parsed.loadout },
        chips: { ...base.chips, ...parsed.chips },
        // 1~2단계 저장 데이터의 muted 필드를 설정으로 옮긴다
        settings: { ...base.settings, ...(muted !== undefined ? { muted } : {}), ...parsed.settings },
      };
    }
  } catch {
    // 저장소를 쓸 수 없으면 새 게임으로 시작
  }
  return defaultSave();
}

export function writeSave(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // 저장 실패는 무시 (시크릿 창 등)
  }
}

/** 도전 가능한 가장 높은 스테이지 id */
export function highestUnlocked(save: SaveData): number {
  let n = 1;
  for (const stage of STAGES) {
    if (save.stars[stage.id]) n = Math.max(n, stage.id + 1);
  }
  return Math.min(n, STAGES.length);
}
