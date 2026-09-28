import type { ChipOption, MoveChip, ResearchDef, TargetChip } from '../game/types';

// 효과는 src/game/stats.ts(무기·기체 스탯)와 모듈/칩의 research 필드에서 id로 참조한다.
export const RESEARCH: ResearchDef[] = [
  { id: 'ap_rounds', branch: '탄도학', name: '철갑탄', desc: '실탄 무기의 장갑 관통 +25%p', cost: 2, requires: null },
  { id: 'rapid_feed', branch: '탄도학', name: '고속 급탄', desc: '실탄 무기의 연사 속도 +20%', cost: 4, requires: 'ap_rounds' },
  { id: 'he_warhead', branch: '폭발물', name: '고폭 탄두', desc: '폭발 반경 +30%, 폭발 피해 +10%, 로켓 런처 구매 가능', cost: 2, requires: null },
  { id: 'cluster', branch: '폭발물', name: '다탄두', desc: '미사일 포드 발사 수 +2', cost: 4, requires: 'he_warhead' },
  { id: 'mortar_tech', branch: '폭발물', name: '박격포 탄도학', desc: '박격포 구매 가능', cost: 4, requires: 'he_warhead' },
  { id: 'flak_tech', branch: '대공', name: '대공 사격 통제', desc: '플랙 포 구매 가능', cost: 2, requires: null },
  { id: 'proximity', branch: '대공', name: '근접 신관', desc: '대공 전용 무기(플랙 포) 피해 +30%, 폭발 반경 +30%', cost: 4, requires: 'flak_tech' },
  { id: 'flame_tech', branch: '화염', name: '화염 공학', desc: '화염방사기 구매 가능', cost: 2, requires: null },
  { id: 'napalm', branch: '화염', name: '네이팜', desc: '화상 피해 +75%, 화상 지속 +1초', cost: 4, requires: 'flame_tech' },
  { id: 'focus_lens', branch: '에너지', name: '집속 렌즈', desc: '에너지 무기 피해 +25%, 사거리 +2', cost: 2, requires: null },
  { id: 'shield_tech', branch: '에너지', name: '실드 공학', desc: '코어 모듈 「실드 발생기」 구매 가능', cost: 4, requires: 'focus_lens' },
  { id: 'armor_plating', branch: '기체 공학', name: '강화 장갑', desc: '기체 체력 +100', cost: 2, requires: null },
  { id: 'reactor', branch: '기체 공학', name: '고출력 원자로', desc: '전력 용량 +2', cost: 4, requires: 'armor_plating' },
  { id: 'nanobots', branch: '기체 공학', name: '나노 수리', desc: '코어 모듈 「수리 나노봇」 구매 가능', cost: 4, requires: 'armor_plating' },
  { id: 'hardpoint', branch: '기체 공학', name: '보조 하드포인트', desc: '두 번째 어깨 슬롯 해금', cost: 6, requires: 'reactor' },
  { id: 'reactor2', branch: '기체 공학', name: '융합 원자로', desc: '전력 용량 +3', cost: 6, requires: 'reactor' },
  { id: 'gauss_tech', branch: '탄도학', name: '가우스 공학', desc: '가우스 캐논 구매 가능', cost: 4, requires: 'ap_rounds' },
  { id: 'gauss_capacitor', branch: '탄도학', name: '초전도 축전기', desc: '가우스 캐논 연사 +25%, 관통 감쇠 없음', cost: 6, requires: 'gauss_tech' },
  { id: 'emp_tech', branch: '에너지', name: '전자기 펄스', desc: 'EMP 방사기 구매 가능', cost: 4, requires: 'focus_lens' },
  { id: 'emp_amplifier', branch: '에너지', name: '펄스 증폭기', desc: 'EMP 반경 +30%, 기절 +0.5초', cost: 6, requires: 'emp_tech' },
  { id: 'reactor3', branch: '기체 공학', name: '초전도 원자로', desc: '전력 용량 +3', cost: 6, requires: 'reactor2' },
  { id: 'target_ai', branch: '전술', name: '표적 분석', desc: '타겟 우선순위 칩 해금 (강한 적 / 약한 적 / 실드 우선)', cost: 2, requires: null },
  { id: 'move_ai', branch: '전술', name: '기동 알고리즘', desc: '이동 성향 칩 해금 (돌격 / 고수)', cost: 2, requires: null },
];

export const RESEARCH_MAP: Record<string, ResearchDef> = Object.fromEntries(RESEARCH.map((r) => [r.id, r]));

export const TARGET_CHIPS: ChipOption<TargetChip>[] = [
  { id: 'nearest', name: '가까운 적', desc: '사거리 안에서 가장 가까운 적을 조준', research: null },
  { id: 'strongest', name: '강한 적 우선', desc: '체력+실드가 가장 많이 남은 적을 조준', research: 'target_ai' },
  { id: 'weakest', name: '약한 적 우선', desc: '곧 쓰러질 적부터 마무리', research: 'target_ai' },
  { id: 'shielded', name: '실드 우선', desc: '실드가 남은 적을 먼저 조준', research: 'target_ai' },
];

// 수치는 src/game/Battle.ts의 MOVE_EFFECTS와 맞춘다
export const MOVE_CHIPS: ChipOption<MoveChip>[] = [
  { id: 'kite', name: '카이팅', desc: '사거리를 유지하며 물러선다. 안전하지만 이동 중에는 연사 -20%', research: null },
  { id: 'charge', name: '돌격', desc: '적에게 파고든다. 이동 속도 +30%, 거리 8 이내 적에게 피해 +20%', research: 'move_ai' },
  { id: 'hold', name: '고수', desc: '중앙에서 버틴다. 멈춰 있는 동안 받는 피해 -25%, 사거리 +15%', research: 'move_ai' },
];
