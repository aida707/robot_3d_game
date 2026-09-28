import './style.css';
import { Arena } from './engine/Arena';
import { buildRobot, type RobotModel } from './engine/models';
import { loadModels } from './engine/assets';
import { DamageNumbers } from './engine/DamageNumbers';
import { Sfx } from './audio/sfx';
import { Music } from './audio/music';
import { Battle } from './game/Battle';
import { defaultSave, loadSave, writeSave } from './game/save';
import { buildBattleSetup, upgradeCost, weaponLevel } from './game/stats';
import { STAGES } from './data/stages';
import { WEAPON_MAP } from './data/weapons';
import { MODULE_MAP } from './data/modules';
import { RESEARCH_MAP } from './data/research';
import { MUSIC_ASSETS, SOUND_ASSETS } from './data/assets';
import {
  renderBriefing,
  renderHangar,
  renderHud,
  renderResult,
  renderStageSelect,
  type HangarTab,
} from './ui/screens';
import type { BattleResult, StageDef } from './game/types';

const arena = new Arena(document.getElementById('app')!);
const ui = document.getElementById('ui')!;
const sfx = new Sfx(SOUND_ASSETS);
const music = new Music(sfx, MUSIC_ASSETS);
// 브라우저가 첫 입력 전에는 소리를 막으므로, 잠금이 풀리면 재생하려던 곡을 시작한다
sfx.onUnlock = () => music.resume();

let save = loadSave();
let robot: RobotModel;
let battle: Battle | null = null;
let timeScale = 1;
let hangarTab: HangarTab = 'weapons';

// 브라우저 오디오 정책: 첫 입력 때 AudioContext를 연다
window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
ui.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('button')) sfx.play('click');
});

function persist(): void {
  writeSave(save);
}

function applySettings(): void {
  sfx.setVolumes(save.settings);
  sfx.useSamples = save.settings.sfxSamples;
  DamageNumbers.enabled = save.settings.damageNumbers;
}

function stageById(id: number): StageDef {
  return STAGES.find((s) => s.id === id)!;
}

function endBattle(): void {
  battle?.dispose();
  battle = null;
}

/** 저장된 디자인으로 로봇을 (다시) 만든다. 위치·방향은 이전 로봇을 이어받는다. */
function rebuildRobot(): void {
  const prev = robot as RobotModel | undefined; // 첫 호출(init)에는 아직 없다
  robot = buildRobot(save.robotSkin);
  if (prev) {
    robot.group.position.copy(prev.group.position);
    robot.group.rotation.copy(prev.group.rotation);
    arena.scene.remove(prev.group);
  }
  robot.setLoadout(save.loadout);
  arena.scene.add(robot.group);
}

/** 메뉴 화면 배경: 격납고에 서 있는 로봇 */
function idleMode(): void {
  endBattle();
  if (arena.viewMode !== 'hangar') arena.setView('hangar');
  music.play('menu');
  robot.group.position.set(0, 0, 0);
  robot.setLoadout(save.loadout);
  robot.animateWalk(0, 0);
  arena.onUpdate = (dt) => {
    robot.group.rotation.y += dt * 0.5;
    robot.update(dt);
  };
}

function goStageSelect(): void {
  idleMode();
  renderStageSelect(ui, save, {
    onPick: goBriefing,
    onReset: () => {
      // 진행 상황만 지우고 설정과 기체 디자인은 유지한다
      const { settings, robotSkin } = save;
      save = { ...defaultSave(), settings, robotSkin };
      persist();
      goStageSelect();
    },
    onSettings: (s) => {
      save.settings = { ...save.settings, ...s };
      applySettings();
      persist();
    },
  });
}

function goBriefing(id: number): void {
  idleMode();
  renderBriefing(ui, stageById(id), save, {
    onNext: () => goHangar(id),
    onBack: goStageSelect,
  });
}

function goHangar(id: number): void {
  idleMode();
  const stage = stageById(id);

  // 변경 후 다시 그리되, 패널 스크롤 위치는 유지한다
  // 변경 후 다시 그리되, 스크롤 위치는 유지한다.
  // 넓은 화면은 패널마다 스크롤되고, 좁은 화면(휴대폰)은 화면 전체가 스크롤된다.
  const refresh = () => {
    persist();
    const screenScroll = ui.querySelector('.screen')?.scrollTop ?? 0;
    const scroll = [...ui.querySelectorAll('.hangar-grid > .panel')].map((p) => p.scrollTop);
    goHangar(id);
    const screen = ui.querySelector('.screen');
    if (screen) screen.scrollTop = screenScroll;
    ui.querySelectorAll('.hangar-grid > .panel').forEach((p, i) => (p.scrollTop = scroll[i] ?? 0));
  };

  renderHangar(ui, stage, save, hangarTab, {
    onEquip: (slot, itemId) => {
      save.loadout[slot] = itemId;
      refresh();
    },
    onBuyWeapon: (weaponId) => {
      const w = WEAPON_MAP[weaponId];
      if (save.credits < w.cost || save.owned.includes(weaponId)) return;
      if (w.research && !save.research.includes(w.research)) return;
      save.credits -= w.cost;
      save.owned.push(weaponId);
      sfx.play('buy');
      refresh();
    },
    onUpgrade: (weaponId) => {
      const lv = weaponLevel(save, weaponId);
      const cost = upgradeCost(WEAPON_MAP[weaponId], lv);
      if (cost === null || save.credits < cost) return;
      save.credits -= cost;
      save.weaponLevels[weaponId] = lv + 1;
      sfx.play('buy');
      refresh();
    },
    onBuyModule: (moduleId) => {
      const m = MODULE_MAP[moduleId];
      if (save.credits < m.cost || save.modules.includes(moduleId)) return;
      if (m.research && !save.research.includes(m.research)) return;
      save.credits -= m.cost;
      save.modules.push(moduleId);
      // 코어가 비어 있으면 바로 장착해 준다
      if (!save.loadout.core) save.loadout.core = moduleId;
      sfx.play('buy');
      refresh();
    },
    onResearch: (researchId) => {
      const r = RESEARCH_MAP[researchId];
      if (save.research.includes(researchId) || save.rp < r.cost) return;
      if (r.requires && !save.research.includes(r.requires)) return;
      save.rp -= r.cost;
      save.research.push(researchId);
      sfx.play('buy');
      refresh();
    },
    onTargetChip: (chip) => {
      save.chips.target = chip;
      refresh();
    },
    onMoveChip: (chip) => {
      save.chips.move = chip;
      refresh();
    },
    onTab: (tab) => {
      hangarTab = tab;
      goHangar(id);
      // 휴대폰처럼 화면 전체가 스크롤되는 배치에서는 탭을 누르면 무기고/모듈/연구 패널 맨 위로 이동
      const screen = ui.querySelector<HTMLElement>('.screen');
      const shop = ui.querySelector<HTMLElement>('.panel.shop');
      if (screen && shop && screen.scrollHeight > screen.clientHeight) {
        screen.scrollTop = shop.getBoundingClientRect().top - screen.getBoundingClientRect().top + screen.scrollTop - 8;
      }
    },
    onSkin: (skinId) => {
      save.robotSkin = skinId;
      rebuildRobot();
      refresh();
    },
    onSortie: () => startBattle(id),
    onBack: () => goBriefing(id),
  });
}

function startBattle(id: number): void {
  endBattle();
  const stage = stageById(id);
  timeScale = 1;
  arena.setView('battle');
  music.play('battle');
  const hud = renderHud(ui, stage, save.settings.muted, {
    onSpeed: (s) => (timeScale = s),
    onToggleMute: () => {
      save.settings.muted = !save.settings.muted;
      applySettings();
      persist();
      return save.settings.muted;
    },
    onToggleCamera: () => {
      const follow = arena.viewMode !== 'follow';
      arena.setView(follow ? 'follow' : 'battle', follow ? robot.group : null);
      return follow;
    },
    onRetreat: () => goHangar(id),
  });
  battle = new Battle(arena, robot, stage, buildBattleSetup(save), sfx, {
    onHud: hud.update,
    onEnd: (result) => showResult(stage, result),
  });
  const current = battle;
  arena.onUpdate = (dt) => current.update(dt * timeScale);
}

function showResult(stage: StageDef, result: BattleResult): void {
  const reward = { credits: 0, rp: 0 };
  if (result.victory) {
    const prevStars = save.stars[stage.id] ?? 0;
    reward.credits = Math.round(prevStars === 0 ? stage.reward : stage.reward * 0.3);
    // 새로 얻은 별 하나당 1 RP
    reward.rp = Math.max(0, result.stars - prevStars);
    save.credits += reward.credits;
    save.rp += reward.rp;
    save.stars[stage.id] = Math.max(prevStars, result.stars);
    persist();
    // 승리 연출: 카메라가 로봇에게 다가간다
    arena.setView('victory', robot.group);
  }
  music.play('menu');
  // 결과 화면 동안 전장은 멈추되, 로봇 애니메이션(승리 춤 / 대기)만 돌린다
  robot.animateWalk(0, 0);
  if (result.victory) robot.playSpecial('victory');
  arena.onUpdate = (dt) => robot.update(dt);
  const next = STAGES.find((s) => s.id === stage.id + 1);
  renderResult(ui, stage, result, reward, {
    onRetry: () => goHangar(stage.id),
    onNext: result.victory && next ? () => goBriefing(next.id) : null,
    onStages: goStageSelect,
  });
}

async function init(): Promise<void> {
  ui.innerHTML = '<div class="loading">로딩 중…</div>';
  const warnings = await loadModels();
  warnings.forEach((w) => console.warn('[에셋]', w));
  rebuildRobot();
  applySettings();
  goStageSelect();
}

if (import.meta.env.DEV) void import('./dev/balance');

void init();
