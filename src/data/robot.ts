import type { SlotDef } from '../game/types';

export const ROBOT = {
  maxHp: 400,
  powerCapacity: 10,
  speed: 3.5,
  radius: 0.9,
  /** 조준 방향 회전 속도 (도/초) */
  turnSpeed: 120,
  /** 전방위가 아닌 무기가 쏠 수 있는 정면 각도 (도, 좌우 절반씩) */
  fireArc: 120,
};

export const SLOTS: SlotDef[] = [
  { id: 'armL', type: 'arm', label: '왼팔' },
  { id: 'armR', type: 'arm', label: '오른팔' },
  { id: 'shoulder', type: 'shoulder', label: '어깨' },
  { id: 'shoulder2', type: 'shoulder', label: '어깨 2', research: 'hardpoint' },
  { id: 'core', type: 'core', label: '코어' },
];
