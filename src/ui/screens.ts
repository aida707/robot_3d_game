import { CHAPTERS, STAGES } from '../data/stages';
import { ENEMY_MAP } from '../data/enemies';
import { WEAPONS, WEAPON_MAP } from '../data/weapons';
import { MODULES, MODULE_MAP } from '../data/modules';
import { MOVE_CHIPS, RESEARCH, RESEARCH_MAP, TARGET_CHIPS } from '../data/research';
import { ROBOT, SLOTS } from '../data/robot';
import { ROBOT_SKINS } from '../data/assets';
import {
  MAX_WEAPON_LEVEL,
  hasAnyWeapon,
  itemPower,
  powerUsed,
  resolveRobot,
  resolveWeapon,
  slotUnlocked,
  upgradeCost,
  weaponLevel,
} from '../game/stats';
import { highestUnlocked } from '../game/save';
import type { HudState } from '../game/Battle';
import type {
  BattleResult,
  ChipOption,
  DamageType,
  EnemyDef,
  MoveChip,
  SaveData,
  Settings,
  SlotId,
  StageDef,
  TargetChip,
  WeaponDef,
} from '../game/types';

export type HangarTab = 'weapons' | 'modules' | 'research';

const DAMAGE_LABEL: Record<DamageType, string> = { kinetic: '실탄', explosive: '폭발', energy: '에너지', thermal: '열' };
const TARGET_LABEL = { both: '지상·공중', ground: '지상 전용', air: '공중 전용' } as const;

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
/** 강화로 소수가 된 스탯은 한 자리까지 */
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);
const chips = (tags: string[]) => tags.map((t) => `<span class="chip">${t}</span>`).join('');
const wallet = (save: SaveData) =>
  `<span class="wallet"><span class="credits">◆ ${fmt(save.credits)} CR</span><span class="rp">▲ ${save.rp} RP</span></span>`;

const STAGE_IS_BOSS = (s: StageDef) => s.waves.some((w) => ENEMY_MAP[w.enemy].boss);

function mount(root: HTMLElement, html: string): HTMLElement {
  root.innerHTML = html.trim();
  return root.firstElementChild as HTMLElement;
}

function on(scope: HTMLElement, selector: string, handler: (el: HTMLElement) => void): void {
  scope.querySelectorAll<HTMLElement>(selector).forEach((el) => el.addEventListener('click', () => handler(el)));
}

/**
 * 게임 화면 안에 그리는 확인창. 브라우저 기본 confirm()은 환경에 따라(앱 내 브라우저 등)
 * 창 없이 바로 false를 돌려주므로 쓰지 않는다.
 */
export function confirmDialog(message: string, okLabel = '확인', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="panel modal" role="dialog" aria-modal="true">
        <p>${message}</p>
        <div class="actions">
          <button class="btn ghost cancel">취소</button>
          <button class="btn ${danger ? 'danger' : 'primary'} ok">${okLabel}</button>
        </div>
      </div>`;
    const close = (result: boolean) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    overlay.querySelector('.cancel')!.addEventListener('click', () => close(false));
    overlay.querySelector('.ok')!.addEventListener('click', () => close(true));
    // 바깥 어두운 영역을 누르면 취소
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector<HTMLElement>('.cancel')!.focus();
  });
}

export function stageEnemies(stage: StageDef): { def: EnemyDef; count: number }[] {
  const counts = new Map<string, number>();
  for (const w of stage.waves) counts.set(w.enemy, (counts.get(w.enemy) ?? 0) + w.count);
  return [...counts].map(([id, count]) => ({ def: ENEMY_MAP[id], count }));
}

function statList(rows: [string, string | number][]): string {
  return `<dl class="stats">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

function enemyCard(def: EnemyDef, count: number): string {
  const rows: [string, string | number][] = [
    ['체력', def.hp],
    ['장갑', def.armor],
  ];
  if (def.shield) rows.push(['실드', `${def.shield} (+${def.shieldRegen}/초)`]);
  if (def.hpRegen) rows.push(['체력 재생', `${def.hpRegen}/초`]);
  rows.push(['속도', def.speed]);
  if (def.flying) rows.push(['이동', '비행']);
  rows.push([
    '공격',
    def.explode
      ? `자폭 ${def.explode.damage}`
      : def.ranged
        ? `${def.attackDamage} / ${def.attackCooldown}초 · 사거리 ${def.attackRange}`
        : `근접 ${def.attackDamage} / ${def.attackCooldown}초`,
  ]);
  if (def.summon) rows.push(['소환', `${def.summon.interval}초마다 ${ENEMY_MAP[def.summon.enemy].name} ${def.summon.count}기`]);
  return `
    <article class="card" style="--accent:${hex(def.color)}">
      <header class="card-head"><b>${def.name}</b><span class="count">×${count}</span></header>
      <div class="chips">${chips(def.tags)}</div>
      <p class="desc">${def.desc}</p>
      ${statList(rows)}
    </article>`;
}

function weaponRows(w: WeaponDef): [string, string | number][] {
  const rows: [string, string | number][] = [
    ['피해', w.burst > 1 ? `${num(w.damage)} ×${w.burst}` : num(w.damage)],
    ['연사', `${num(w.fireRate)}/초`],
    ['사거리', w.minRange ? `${w.minRange}~${num(w.range)}` : num(w.range)],
    ['속성', DAMAGE_LABEL[w.damageType]],
    ['조준', TARGET_LABEL[w.targets]],
    ['사격 방향', w.omni ? '전방위' : `전방 ${ROBOT.fireArc}°`],
  ];
  if (w.pierce) rows.push(['장갑 관통', `${Math.round(w.pierce * 100)}%`]);
  if (w.aoeRadius) rows.push(['폭발 반경', num(w.aoeRadius)]);
  if (w.coneAngle) rows.push(['부채꼴', `${w.coneAngle}°`]);
  if (w.burn) rows.push(['화상', `${num(w.burn.dps)}/초 · ${w.burn.duration}초`]);
  if (w.lineShot) rows.push(['일렬 관통', w.lineShot.falloff ? `뒤로 갈수록 -${Math.round(w.lineShot.falloff * 100)}%` : '감쇠 없음']);
  if (w.stun) rows.push(['기절', `${num(w.stun)}초 (보스 절반)`]);
  rows.push(['전력', w.power], ['슬롯', w.slot === 'arm' ? '팔' : '어깨']);
  return rows;
}

function levelPips(level: number): string {
  let s = '';
  for (let i = 1; i <= MAX_WEAPON_LEVEL; i++) s += `<i class="${i <= level ? 'on' : ''}"></i>`;
  return `<span class="pips" title="강화 Lv ${level}">${s}</span>`;
}

// ─── 스테이지 선택 ───────────────────────────────────────

export function renderStageSelect(
  root: HTMLElement,
  save: SaveData,
  cb: { onPick(id: number): void; onReset(): void; onSettings(s: Partial<Settings>): void },
): void {
  const s = save.settings;
  const unlocked = highestUnlocked(save);
  const node = mount(
    root,
    `
    <div class="screen stage-select">
      <header class="title">
        <h1>MECH TACTICS</h1>
        <p>적을 분석하고, 로봇을 무장하고, 자동 전투로 증명하라.</p>
      </header>
      <section class="panel stage-list">
        <header class="panel-head"><h2>작전 목록</h2>${wallet(save)}</header>
        <div class="stage-scroll">
        ${CHAPTERS.map((ch) => {
          const chStages = STAGES.filter((s) => s.id >= ch.from && s.id <= ch.to);
          const chStars = chStages.reduce((sum, s) => sum + (save.stars[s.id] ?? 0), 0);
          return `
            <h3 class="chapter">${ch.id}장 · ${ch.name} <span>★ ${chStars}/${chStages.length * 3}</span></h3>
            ${chStages
              .map((s) => {
                const locked = s.id > unlocked;
                const got = save.stars[s.id] ?? 0;
                return `
                <button class="stage-btn ${STAGE_IS_BOSS(s) ? 'boss' : ''}" data-id="${s.id}" ${locked ? 'disabled' : ''}>
                  <span class="num">STAGE ${s.id}</span>
                  <span class="name">${locked ? '잠김' : s.name}</span>
                  <span class="stars ${got ? 'got' : ''}">${stars(got)}</span>
                </button>`;
              })
              .join('')}`;
        }).join('')}
        </div>
        <p class="note">새로 얻은 별 하나당 연구 포인트(RP) 1을 받습니다.</p>
        <details class="settings">
          <summary>설정</summary>
          <label class="range"><span>효과음</span><input type="range" min="0" max="100" value="${Math.round(s.sfx * 100)}" data-setting="sfx" /></label>
          <label class="range"><span>배경음</span><input type="range" min="0" max="100" value="${Math.round(s.music * 100)}" data-setting="music" /></label>
          <label class="check"><input type="checkbox" data-setting="muted" ${s.muted ? 'checked' : ''} /> 전체 음소거</label>
          <label class="check"><input type="checkbox" data-setting="sfxSamples" ${s.sfxSamples ? 'checked' : ''} /> 효과음 샘플 사용 (끄면 합성음)</label>
          <label class="check"><input type="checkbox" data-setting="damageNumbers" ${s.damageNumbers ? 'checked' : ''} /> 피해 숫자 표시</label>
          <label class="check"><input type="checkbox" data-setting="torsoAim" ${s.torsoAim ? 'checked' : ''} /> 상체만 조준 방향으로 회전 (끄면 몸 전체 회전)</label>
          <p class="note">시점 조작: 드래그로 회전, 휠(휴대폰은 두 손가락)로 확대·축소, 더블클릭으로 초기화</p>
        </details>
        <button class="link reset">진행 초기화</button>
      </section>
    </div>`,
  );
  node.querySelectorAll<HTMLInputElement>('input[data-setting]').forEach((input) => {
    const key = input.dataset.setting as keyof Settings;
    // 슬라이더는 드래그 중에도 바로 반영해 소리 크기를 들으며 조절할 수 있게 한다
    input.addEventListener(input.type === 'range' ? 'input' : 'change', () => {
      cb.onSettings({ [key]: input.type === 'range' ? Number(input.value) / 100 : input.checked });
    });
  });
  on(node, '.stage-btn', (el) => cb.onPick(Number(el.dataset.id)));
  on(node, '.reset', async () => {
    const ok = await confirmDialog(
      '모든 진행 상황(크레딧, RP, 무기, 연구, 별점)을 초기화할까요?<br />되돌릴 수 없습니다. 설정과 기체 디자인은 유지됩니다.',
      '초기화',
      true,
    );
    if (ok) cb.onReset();
  });
}

// ─── 브리핑 ─────────────────────────────────────────────

export function renderBriefing(
  root: HTMLElement,
  stage: StageDef,
  save: SaveData,
  cb: { onNext(): void; onBack(): void },
): void {
  const firstClear = !save.stars[stage.id];
  const node = mount(
    root,
    `
    <div class="screen briefing">
      <section class="panel briefing-panel">
        <header>
          <span class="eyebrow">작전 브리핑 · STAGE ${stage.id}</span>
          <h2>${stage.name}</h2>
          <p class="lead">${stage.briefing}</p>
        </header>
        <h3>확인된 적 전력${stage.hpScale && stage.hpScale > 1 ? ` <span class="elite">강화 개체: 체력·실드 ×${stage.hpScale}</span>` : ''}</h3>
        <div class="card-grid">${stageEnemies(stage).map(({ def, count }) => enemyCard(def, count)).join('')}</div>
        <div class="hint"><b>분석관 메모</b> ${stage.hint}</div>
        <p class="reward">보상: ◆ ${fmt(firstClear ? stage.reward : stage.reward * 0.3)} CR ${firstClear ? '(첫 클리어)' : '(재클리어 30%)'} · 새 별 1개당 ▲ 1 RP (현재 ${stars(save.stars[stage.id] ?? 0)})</p>
      </section>
      <div class="actions">
        <button class="btn ghost back">← 작전 목록</button>
        <button class="btn primary next">격납고로 →</button>
      </div>
    </div>`,
  );
  on(node, '.back', cb.onBack);
  on(node, '.next', cb.onNext);
}

// ─── 격납고 ─────────────────────────────────────────────

export interface HangarCallbacks {
  onEquip(slot: SlotId, id: string | null): void;
  onBuyWeapon(id: string): void;
  onUpgrade(id: string): void;
  onBuyModule(id: string): void;
  onResearch(id: string): void;
  onTargetChip(id: TargetChip): void;
  onMoveChip(id: MoveChip): void;
  onTab(tab: HangarTab): void;
  onSkin(skinId: string): void;
  onSortie(): void;
  onBack(): void;
}

function chipSelect<T extends string>(kind: string, label: string, options: ChipOption<T>[], current: T, save: SaveData): string {
  const opts = options
    .map((o) => {
      const locked = o.research !== null && !save.research.includes(o.research);
      return `<option value="${o.id}" ${o.id === current ? 'selected' : ''} ${locked ? 'disabled' : ''}>${o.name}${locked ? ' (연구 필요)' : ''}</option>`;
    })
    .join('');
  const desc = options.find((o) => o.id === current)?.desc ?? '';
  return `
    <label class="slot">
      <span>${label}</span>
      <select data-chip="${kind}">${opts}</select>
    </label>
    <p class="chip-desc">${desc}</p>`;
}

function weaponsTab(save: SaveData): string {
  return WEAPONS.map((base) => {
    const owned = save.owned.includes(base.id);
    const lv = weaponLevel(save, base.id);
    const w = owned ? resolveWeapon(save, base.id) : base;
    const needs = base.research && !save.research.includes(base.research) ? RESEARCH_MAP[base.research] : null;
    let action: string;
    if (!owned && needs) {
      action = `<span class="locked-tag">연구 필요: ${needs.name}</span>`;
    } else if (!owned) {
      action = `<button class="btn buy" data-buy-weapon="${base.id}" ${save.credits >= base.cost ? '' : 'disabled'}>구매 ◆ ${fmt(base.cost)}</button>`;
    } else {
      const cost = upgradeCost(base, lv);
      action =
        cost === null
          ? '<span class="owned">최대 강화</span>'
          : `<button class="btn buy" data-upgrade="${base.id}" ${save.credits >= cost ? '' : 'disabled'}>강화 ◆ ${fmt(cost)}</button>`;
    }
    return `
      <article class="card ${owned ? '' : 'locked'}" style="--accent:${hex(base.color)}">
        <header class="card-head"><b>${base.name} ${owned ? levelPips(lv) : ''}</b>${action}</header>
        <div class="chips">${chips(base.tags)}</div>
        <p class="desc">${base.desc}</p>
        ${statList(weaponRows(w))}
        ${owned && lv < MAX_WEAPON_LEVEL ? '<p class="note">강화 1단계마다 피해 +10%, 연사 +5%. 높은 단계일수록 비용이 크게 오릅니다</p>' : ''}
      </article>`;
  }).join('');
}

function modulesTab(save: SaveData): string {
  const intro = '<p class="note">코어 슬롯에 하나만 장착할 수 있습니다. 일부 모듈은 연구가 필요합니다.</p>';
  return (
    intro +
    MODULES.map((m) => {
      const owned = save.modules.includes(m.id);
      const needs = m.research && !save.research.includes(m.research) ? RESEARCH_MAP[m.research] : null;
      let action: string;
      if (owned) action = '<span class="owned">보유</span>';
      else if (needs) action = `<span class="locked-tag">연구 필요: ${needs.name}</span>`;
      else action = `<button class="btn buy" data-buy-module="${m.id}" ${save.credits >= m.cost ? '' : 'disabled'}>구매 ◆ ${fmt(m.cost)}</button>`;
      return `
        <article class="card ${owned ? '' : 'locked'}" style="--accent:${hex(m.color)}">
          <header class="card-head"><b>${m.name}</b>${action}</header>
          <p class="desc">${m.desc}</p>
          ${statList([['전력', m.power]])}
        </article>`;
    }).join('')
  );
}

function researchTab(save: SaveData): string {
  const branches = [...new Set(RESEARCH.map((r) => r.branch))];
  return (
    `<p class="note">별을 새로 얻을 때마다 RP를 받습니다. 모든 연구를 하기엔 RP가 부족하니 골라서 투자하세요.</p>` +
    branches
      .map((branch) => {
        const nodes = RESEARCH.filter((r) => r.branch === branch)
          .map((r) => {
            const done = save.research.includes(r.id);
            const blocked = r.requires !== null && !save.research.includes(r.requires);
            let action: string;
            if (done) action = '<span class="owned">완료</span>';
            else if (blocked) action = `<span class="locked-tag">선행: ${RESEARCH_MAP[r.requires!].name}</span>`;
            else action = `<button class="btn buy" data-research="${r.id}" ${save.rp >= r.cost ? '' : 'disabled'}>연구 ▲ ${r.cost}</button>`;
            return `
              <div class="research-node ${done ? 'done' : ''}">
                <div class="card-head"><b>${r.name}</b>${action}</div>
                <p class="desc">${r.desc}</p>
              </div>`;
          })
          .join('');
        return `<section class="branch"><h3>${branch}</h3>${nodes}</section>`;
      })
      .join('')
  );
}

export function renderHangar(root: HTMLElement, stage: StageDef, save: SaveData, tab: HangarTab, cb: HangarCallbacks): void {
  const robotStats = resolveRobot(save);
  const used = powerUsed(save.loadout);
  const over = used > robotStats.powerCapacity;
  const canSortie = !over && hasAnyWeapon(save.loadout);

  const slotRows = SLOTS.map((slot) => {
    if (!slotUnlocked(save, slot)) {
      return `
      <label class="slot">
        <span>${slot.label}</span>
        <select disabled><option>연구 필요: ${RESEARCH_MAP[slot.research!].name}</option></select>
      </label>`;
    }
    const items =
      slot.type === 'core'
        ? save.modules.map((id) => ({ id, name: MODULE_MAP[id].name }))
        : save.owned.map((id) => WEAPON_MAP[id]).filter((w) => w.slot === slot.type);
    const options = items
      .map((it) => {
        const p = itemPower(slot.id, it.id);
        return `<option value="${it.id}" ${save.loadout[slot.id] === it.id ? 'selected' : ''}>${it.name}${p ? ` (전력 ${p})` : ''}</option>`;
      })
      .join('');
    return `
      <label class="slot">
        <span>${slot.label}</span>
        <select data-slot="${slot.id}">
          <option value="">— 비어 있음 —</option>${options}
        </select>
      </label>`;
  }).join('');

  const statParts = [`체력 ${robotStats.maxHp}`];
  if (robotStats.shield) statParts.push(`실드 ${robotStats.shield}`);
  if (robotStats.repair) statParts.push(`수리 ${robotStats.repair}/초`);
  statParts.push(`이동 속도 ${robotStats.speed}`, `회전 ${ROBOT.turnSpeed}°/초`);

  const tabs: [HangarTab, string][] = [
    ['weapons', '무기고'],
    ['modules', '코어 모듈'],
    ['research', '연구'],
  ];
  const tabBody = tab === 'weapons' ? weaponsTab(save) : tab === 'modules' ? modulesTab(save) : researchTab(save);

  const node = mount(
    root,
    `
    <div class="screen hangar">
      <header class="panel topbar">
        <div><span class="eyebrow">격납고</span> <b>STAGE ${stage.id} · ${stage.name}</b></div>
        ${wallet(save)}
      </header>
      <div class="hangar-grid">
        <section class="panel loadout">
          <h2>장착</h2>
          <label class="slot">
            <span>디자인</span>
            <select data-skin>
              ${ROBOT_SKINS.map((s) => `<option value="${s.id}" ${s.id === save.robotSkin ? 'selected' : ''}>${s.name}</option>`).join('')}
            </select>
          </label>
          <p class="chip-desc">겉모습만 바뀌며 성능은 모두 같습니다.</p>
          ${slotRows}
          <div class="power ${over ? 'over' : ''}">
            <div class="power-head"><span>전력</span><b>${used} / ${robotStats.powerCapacity}</b></div>
            <div class="meter"><i style="width:${Math.min(100, (used / robotStats.powerCapacity) * 100)}%"></i></div>
            ${over ? '<p class="warn">전력 초과! 무기나 모듈을 줄이세요.</p>' : ''}
          </div>
          <p class="robot-stat">${statParts.join(' · ')}</p>
          <h3>전술 칩</h3>
          ${chipSelect('target', '조준', TARGET_CHIPS, save.chips.target, save)}
          ${chipSelect('move', '이동', MOVE_CHIPS, save.chips.move, save)}
          <h3>이번 적</h3>
          <ul class="enemy-mini">
            ${stageEnemies(stage)
              .map(({ def, count }) => `<li style="--accent:${hex(def.color)}"><b>${def.name}</b> ×${count}<div class="chips">${chips(def.tags)}</div></li>`)
              .join('')}
          </ul>
        </section>
        <section class="panel shop">
          <nav class="tabs">
            ${tabs.map(([id, label]) => `<button class="tab ${id === tab ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}
          </nav>
          <div class="tab-body">${tabBody}</div>
        </section>
      </div>
      <div class="actions">
        <button class="btn ghost back">← 브리핑</button>
        <button class="btn primary sortie" ${canSortie ? '' : 'disabled'}>출격 ▶</button>
      </div>
    </div>`,
  );

  node.querySelectorAll<HTMLSelectElement>('select[data-slot]').forEach((sel) => {
    sel.addEventListener('change', () => cb.onEquip(sel.dataset.slot as SlotId, sel.value || null));
  });
  const skinSelect = node.querySelector<HTMLSelectElement>('select[data-skin]')!;
  skinSelect.addEventListener('change', () => cb.onSkin(skinSelect.value));
  node.querySelectorAll<HTMLSelectElement>('select[data-chip]').forEach((sel) => {
    sel.addEventListener('change', () => {
      if (sel.dataset.chip === 'target') cb.onTargetChip(sel.value as TargetChip);
      else cb.onMoveChip(sel.value as MoveChip);
    });
  });
  on(node, '[data-tab]', (el) => cb.onTab(el.dataset.tab as HangarTab));
  on(node, '[data-buy-weapon]', (el) => cb.onBuyWeapon(el.dataset.buyWeapon!));
  on(node, '[data-upgrade]', (el) => cb.onUpgrade(el.dataset.upgrade!));
  on(node, '[data-buy-module]', (el) => cb.onBuyModule(el.dataset.buyModule!));
  on(node, '[data-research]', (el) => cb.onResearch(el.dataset.research!));
  on(node, '.back', cb.onBack);
  on(node, '.sortie', cb.onSortie);
}

// ─── 전투 HUD ───────────────────────────────────────────

export function renderHud(
  root: HTMLElement,
  stage: StageDef,
  muted: boolean,
  cb: {
    onSpeed(scale: number): void;
    onToggleMute(): boolean;
    /** 추적 시점이면 true를 돌려준다 */
    onToggleCamera(): boolean;
    onRetreat(): void;
  },
): { update(s: HudState): void } {
  const node = mount(
    root,
    `
    <div class="screen hud">
      <div class="hud-row">
        <div class="panel hud-hp">
          <span class="eyebrow">기체 내구도</span>
          <div class="meter shield" hidden><i></i></div>
          <div class="meter hp"><i></i></div>
          <b class="hp-text"></b>
        </div>
        <div class="panel hud-info">
          <span class="eyebrow">STAGE ${stage.id} · ${stage.name}</span>
          <b class="remain"></b>
        </div>
        <div class="panel hud-controls">
          <button class="btn speed active" data-speed="1">1×</button>
          <button class="btn speed" data-speed="2">2×</button>
          <button class="btn speed" data-speed="4">4×</button>
          <button class="btn camera" title="전체 시점 / 로봇 추적 시점 전환">🎥 전체</button>
          <button class="btn mute">${muted ? '🔇' : '🔊'}</button>
          <button class="btn ghost retreat">철수</button>
        </div>
      </div>
      <div class="panel hud-boss" hidden>
        <b class="boss-name"></b>
        <div class="meter shield"><i></i></div>
        <div class="meter hp"><i></i></div>
      </div>
      <p class="hud-hint">드래그: 회전 · 휠: 확대 · 더블클릭: 시점 초기화</p>
    </div>`,
  );
  on(node, '.camera', (el) => {
    el.textContent = cb.onToggleCamera() ? '🎥 추적' : '🎥 전체';
  });
  const hpBar = node.querySelector<HTMLElement>('.meter.hp i')!;
  const shieldMeter = node.querySelector<HTMLElement>('.meter.shield')!;
  const shieldBar = shieldMeter.querySelector<HTMLElement>('i')!;
  const hpText = node.querySelector<HTMLElement>('.hp-text')!;
  const remain = node.querySelector<HTMLElement>('.remain')!;
  const bossPanel = node.querySelector<HTMLElement>('.hud-boss')!;
  const bossName = bossPanel.querySelector<HTMLElement>('.boss-name')!;
  const bossHp = bossPanel.querySelector<HTMLElement>('.meter.hp i')!;
  const bossShield = bossPanel.querySelector<HTMLElement>('.meter.shield i')!;

  on(node, '.speed', (el) => {
    node.querySelectorAll('.speed').forEach((b) => b.classList.toggle('active', b === el));
    cb.onSpeed(Number(el.dataset.speed));
  });
  on(node, '.mute', (el) => {
    el.textContent = cb.onToggleMute() ? '🔇' : '🔊';
  });
  on(node, '.retreat', cb.onRetreat);

  return {
    update(s) {
      const ratio = s.hp / s.maxHp;
      hpBar.style.width = `${ratio * 100}%`;
      hpBar.style.background = ratio > 0.5 ? 'var(--ok)' : ratio > 0.25 ? 'var(--warn)' : 'var(--bad)';
      shieldMeter.hidden = s.maxShield <= 0;
      if (s.maxShield > 0) shieldBar.style.width = `${(s.shield / s.maxShield) * 100}%`;
      hpText.textContent = `${fmt(s.hp)} / ${s.maxHp}` + (s.maxShield > 0 ? ` · 실드 ${fmt(s.shield)}` : '');
      remain.textContent = `남은 적 ${s.remaining} / ${s.total} · ${s.elapsed.toFixed(1)}초`;
      bossPanel.hidden = !s.boss;
      if (s.boss) {
        bossName.textContent = `${s.boss.name}  ${fmt(s.boss.hp)} / ${fmt(s.boss.maxHp)}`;
        bossHp.style.width = `${(s.boss.hp / s.boss.maxHp) * 100}%`;
        bossShield.style.width = `${s.boss.maxShield ? (s.boss.shield / s.boss.maxShield) * 100 : 0}%`;
      }
    },
  };
}

// ─── 결과 ───────────────────────────────────────────────

export function renderResult(
  root: HTMLElement,
  stage: StageDef,
  result: BattleResult,
  reward: { credits: number; rp: number },
  cb: { onRetry(): void; onNext: (() => void) | null; onStages(): void },
): void {
  const node = mount(
    root,
    `
    <div class="screen result">
      <section class="panel result-panel ${result.victory ? 'win' : 'lose'}">
        <span class="eyebrow">STAGE ${stage.id} · ${stage.name}</span>
        <h2>${result.victory ? '작전 성공' : '기체 파괴'}</h2>
        ${result.victory ? `<div class="big-stars">${stars(result.stars)}</div>` : ''}
        ${statList([
          ['남은 내구도', `${Math.round(result.hpRatio * 100)}%`],
          ['격파', `${result.kills} / ${result.total}`],
          ['전투 시간', `${result.time.toFixed(1)}초`],
          ['보상', `◆ ${fmt(reward.credits)} CR` + (reward.rp ? ` · ▲ ${reward.rp} RP` : '')],
        ])}
        ${result.victory ? '' : '<p class="lead">브리핑의 적 구성을 다시 보고 무장을 바꿔 보세요.</p>'}
      </section>
      <div class="actions">
        <button class="btn ghost stages">작전 목록</button>
        <button class="btn retry">격납고 (재정비)</button>
        ${cb.onNext ? '<button class="btn primary next">다음 작전 →</button>' : ''}
      </div>
    </div>`,
  );
  on(node, '.stages', cb.onStages);
  on(node, '.retry', cb.onRetry);
  if (cb.onNext) on(node, '.next', cb.onNext);
}
