import type { SlotDef } from '../game/types';

export const ROBOT = {
  maxHp: 400,
  powerCapacity: 10,
  speed: 3.5,
  radius: 0.9,
};

export const SLOTS: SlotDef[] = [
  { id: 'armL', type: 'arm', label: '왼팔' },
  { id: 'armR', type: 'arm', label: '오른팔' },
  { id: 'shoulder', type: 'shoulder', label: '어깨' },
  { id: 'shoulder2', type: 'shoulder', label: '어깨 2', research: 'hardpoint' },
  { id: 'core', type: 'core', label: '코어' },
];
