import * as THREE from 'three';
import type { Arena } from '../engine/Arena';
import { buildEnemy, type EnemyModel, type RobotModel } from '../engine/models';
import { Effects, makeBeam, setBeam } from '../engine/effects';
import { HealthBar } from '../engine/HealthBar';
import { DamageNumbers, type NumberKind } from '../engine/DamageNumbers';
import { ENEMY_MAP } from '../data/enemies';
import { ROBOT, SLOTS } from '../data/robot';
import type { Sfx } from '../audio/sfx';
import { applyDamage } from './damage';
import type {
  BattleResult,
  BattleSetup,
  DamageType,
  EnemyDef,
  MoveChip,
  RobotStats,
  StageDef,
  TargetChip,
  TargetLayer,
  WeaponDef,
} from './types';

/** 로봇 실드가 다시 차오르기 시작하기까지 피격 없이 버텨야 하는 시간(초) */
const ROBOT_SHIELD_DELAY = 2;

/** 이동 칩 특수 능력 (src/data/research.ts의 칩 설명과 맞춘다) */
const MOVE_EFFECTS = {
  /** 카이팅: 이동 중 연사 배율 */
  kiteMovingFireRate: 0.8,
  /** 돌격: 이동 속도 배율, 근거리 피해 배율과 그 거리 */
  chargeSpeed: 1.3,
  chargeDamage: 1.2,
  chargeRange: 8,
  /** 고수: 멈춰 있는 동안 받는 피해 배율과 사거리 배율 */
  holdDamageTaken: 0.75,
  holdRange: 1.15,
};

const ROBOT_CHEST_Y = 2.1;
/** 피해 숫자를 모아서 띄우는 간격(초). 연사 무기가 숫자로 화면을 덮지 않게 한다. */
const NUMBER_WINDOW = 0.25;

/** 짧은 시간 동안 받은 피해를 합산한다 */
interface DamageAcc {
  shield: number;
  hp: number;
  raw: number;
  timer: number;
}

const newAcc = (): DamageAcc => ({ shield: 0, hp: 0, raw: 0, timer: 0 });

const bulletGeo = new THREE.SphereGeometry(0.09, 6, 4);
const missileGeo = new THREE.ConeGeometry(0.1, 0.45, 6).rotateX(Math.PI / 2);
const enemyShotGeo = new THREE.SphereGeometry(0.18, 8, 6);
const projectileMats = new Map<number, THREE.MeshBasicMaterial>();

function projectileMat(color: number): THREE.MeshBasicMaterial {
  let m = projectileMats.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    projectileMats.set(color, m);
  }
  return m;
}

function layerMatches(layer: TargetLayer, e: { def: EnemyDef }): boolean {
  return layer === 'both' || (layer === 'air') === !!e.def.flying;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

interface Enemy {
  def: EnemyDef;
  model: EnemyModel;
  pos: THREE.Vector3;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  cooldown: number;
  alive: boolean;
  bar: HealthBar;
  flash: number;
  shieldPulse: number;
  phase: number;
  acc: DamageAcc;
  /** 남은 화상 시간(초)과 초당 피해 */
  burn: number;
  burnDps: number;
  summonTimer: number;
  /** 남은 기절 시간(초) */
  stun: number;
}

interface WeaponState {
  def: WeaponDef;
  mesh: THREE.Object3D;
  muzzle: THREE.Object3D;
  cooldown: number;
  beam: THREE.Mesh | null;
  beamTarget: Enemy | null;
  recoil: number;
}

interface Projectile {
  kind: 'bullet' | 'missile' | 'enemy' | 'mortar' | 'flak';
  /** 광역 피해가 닿는 층 (미사일은 쏜 대상의 층을 따른다) */
  layer: TargetLayer;
  /** 박격포 포물선 비행용 */
  arc?: { from: THREE.Vector3; to: THREE.Vector3; t: number; duration: number; height: number };
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  speed: number;
  target: Enemy | null;
  aim: THREE.Vector3;
  weapon: WeaponDef | null;
  damage: number;
  life: number;
  trail: number;
  done: boolean;
}

export interface HudState {
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  remaining: number;
  total: number;
  elapsed: number;
  /** 살아 있는 보스 (여럿이면 체력이 가장 많은 쪽) */
  boss: { name: string; hp: number; maxHp: number; shield: number; maxShield: number } | null;
}

export interface BattleCallbacks {
  onHud(state: HudState): void;
  onEnd(result: BattleResult): void;
}

/** 한 스테이지의 자동 전투 시뮬레이션과 연출. */
export class Battle {
  private effects: Effects;
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private weapons: WeaponState[] = [];
  private spawnQueue: { time: number; enemyId: string; angle: number }[] = [];
  private spawnIndex = 0;
  private total: number;
  private killed = 0;
  private elapsed = 0;
  private stats: RobotStats;
  private targetChip: TargetChip;
  private moveChip: MoveChip;
  /** 이번 스텝에 로봇이 움직였는지 (칩 능력 판정용) */
  private robotMoving = false;
  private hp: number;
  private shield: number;
  private lastHitAt = -Infinity;
  private shieldBubble: THREE.Mesh | null = null;
  private shieldPulse = 0;
  private preferredRange: number;
  private walkPhase = 0;
  private walkAmount = 0;
  private robotFlash = 0;
  private robotDead = false;
  private finished = false;
  private endTimer = 0;
  private result: BattleResult | null = null;
  private endSent = false;
  private numbers: DamageNumbers | null;
  private robotAcc = newAcc();
  private hpScale: number;

  constructor(
    private arena: Arena,
    private robot: RobotModel,
    stage: StageDef,
    setup: BattleSetup,
    private sfx: Sfx,
    private cb: BattleCallbacks,
  ) {
    this.effects = new Effects(arena.scene);
    // 헤드리스 시뮬레이션(가짜 Arena)에는 오버레이가 없다
    this.numbers = arena.overlay ? new DamageNumbers(arena.overlay) : null;
    this.hpScale = stage.hpScale ?? 1;
    this.stats = setup.robot;
    this.hp = setup.robot.maxHp;
    this.shield = setup.robot.shield;
    this.targetChip = setup.chips.target;
    this.moveChip = setup.chips.move;
    robot.group.position.set(0, 0, 0);
    robot.group.rotation.set(0, 0, 0);
    robot.group.visible = true;
    robot.setLoadout(setup.loadout);
    robot.group.updateMatrixWorld(true);

    if (this.stats.shield > 0) {
      this.shieldBubble = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 24, 16),
        new THREE.MeshBasicMaterial({
          color: 0x4fb3ff,
          transparent: true,
          opacity: 0.2,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      this.shieldBubble.position.y = 1.6;
      robot.group.add(this.shieldBubble);
    }

    let minRange = Infinity;
    for (const slot of SLOTS) {
      const def = setup.weapons[slot.id];
      const mesh = robot.weaponMeshes[slot.id];
      if (!def || !mesh) continue;
      const beam = def.fireMode === 'beam' ? makeBeam(def.color) : null;
      if (beam) {
        beam.visible = false;
        arena.scene.add(beam);
      }
      this.weapons.push({
        def,
        mesh,
        muzzle: mesh.userData.muzzle as THREE.Object3D,
        cooldown: Math.random() * 0.3,
        beam,
        beamTarget: null,
        recoil: 0,
      });
      minRange = Math.min(minRange, def.range);
    }
    const baseRange = Number.isFinite(minRange) ? minRange : 10;
    this.preferredRange = baseRange * (this.moveChip === 'charge' ? 0.35 : 0.8);

    for (const wave of stage.waves) {
      const baseAngle = Math.random() * Math.PI * 2;
      for (let i = 0; i < wave.count; i++) {
        this.spawnQueue.push({
          time: wave.start + i * wave.interval,
          enemyId: wave.enemy,
          angle: baseAngle + (Math.random() - 0.5) * (wave.spread ?? 1.2),
        });
      }
    }
    this.spawnQueue.sort((a, b) => a.time - b.time);
    this.total = this.spawnQueue.length;
  }

  update(dt: number): void {
    // 배속을 올려도 판정이 안정적이도록 고정 스텝으로 나눈다
    let remaining = dt;
    while (remaining > 1e-6) {
      const step = Math.min(remaining, 1 / 60);
      this.step(step);
      remaining -= step;
    }
    if (this.numbers) {
      const canvas = this.arena.renderer.domElement;
      this.numbers.render(this.arena.camera, canvas.clientWidth, canvas.clientHeight);
    }
    let boss: Enemy | null = null;
    for (const e of this.enemies) {
      if (e.alive && e.def.boss && (!boss || e.hp > boss.hp)) boss = e;
    }
    this.cb.onHud({
      hp: this.hp,
      maxHp: this.stats.maxHp,
      shield: this.shield,
      maxShield: this.stats.shield,
      remaining: this.total - this.killed,
      total: this.total,
      elapsed: this.elapsed,
      boss: boss
        ? { name: boss.def.name, hp: boss.hp, maxHp: boss.maxHp, shield: boss.shield, maxShield: boss.maxShield }
        : null,
    });
  }

  dispose(): void {
    const scene = this.arena.scene;
    for (const e of this.enemies) if (e.alive) this.removeEnemy(e);
    for (const p of this.projectiles) scene.remove(p.mesh);
    for (const w of this.weapons) {
      if (w.beam) {
        scene.remove(w.beam);
        (w.beam.material as THREE.Material).dispose();
      }
    }
    this.effects.clear();
    this.numbers?.clear();
    if (this.shieldBubble) {
      this.robot.group.remove(this.shieldBubble);
      this.shieldBubble.geometry.dispose();
      (this.shieldBubble.material as THREE.Material).dispose();
    }
    this.robot.group.visible = true;
    this.robot.setHitFlash(0);
    this.robot.resetPose();
    this.robot.animateWalk(0, 0);
  }

  // ─── 메인 스텝 ──────────────────────────────────────────

  private step(dt: number): void {
    this.elapsed += dt;
    if (!this.finished) {
      this.spawnDue();
      this.updateRobot(dt);
      this.updateWeapons(dt);
    }
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.effects.update(dt);
    this.updateBars();
    this.robot.update(dt);

    this.robotFlash = Math.max(0, this.robotFlash - dt * 5);
    this.robot.setHitFlash(this.robotFlash);

    if (this.robotAcc.timer > 0) {
      this.robotAcc.timer -= dt;
      if (this.robotAcc.timer <= 0) this.flushRobotNumber();
    }
    this.numbers?.tick(dt);

    if (!this.finished) {
      if (this.spawnIndex >= this.spawnQueue.length && this.enemies.length === 0) this.finish(true);
    } else if (!this.endSent) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.result) {
        this.endSent = true;
        this.cb.onEnd(this.result);
      }
    }
  }

  private finish(victory: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.endTimer = victory ? 1.5 : 2.5;
    for (const w of this.weapons) if (w.beam) w.beam.visible = false;
    this.robot.animateWalk(0, 0);
    const ratio = this.hp / this.stats.maxHp;
    const stars = victory ? (ratio >= 0.6 ? 3 : ratio >= 0.3 ? 2 : 1) : 0;
    this.result = { victory, hpRatio: ratio, stars, time: this.elapsed, kills: this.killed, total: this.total };
    this.sfx.play(victory ? 'win' : 'lose');
  }

  // ─── 스폰 ──────────────────────────────────────────────

  private spawnDue(): void {
    while (this.spawnIndex < this.spawnQueue.length && this.spawnQueue[this.spawnIndex].time <= this.elapsed) {
      const s = this.spawnQueue[this.spawnIndex++];
      const r = this.arena.radius - 1;
      this.spawnEnemy(ENEMY_MAP[s.enemyId], new THREE.Vector3(Math.cos(s.angle) * r, 0, Math.sin(s.angle) * r));
    }
  }

  private spawnEnemy(def: EnemyDef, pos: THREE.Vector3): void {
    const model = buildEnemy(def);
    model.group.position.copy(pos);
    this.arena.scene.add(model.group);
    const bar = new HealthBar(Math.max(0.8, def.radius * 1.4), def.shield > 0);
    bar.group.visible = false;
    this.arena.scene.add(bar.group);
    const hp = def.hp * this.hpScale;
    const shield = def.shield * this.hpScale;
    this.enemies.push({
      def,
      model,
      pos,
      hp,
      maxHp: hp,
      shield,
      maxShield: shield,
      cooldown: def.attackCooldown * Math.random(),
      alive: true,
      bar,
      flash: 0,
      shieldPulse: 0,
      phase: Math.random() * 10,
      acc: newAcc(),
      burn: 0,
      burnDps: 0,
      stun: 0,
      summonTimer: def.summon ? def.summon.interval * 0.5 : 0,
    });
    this.effects.flash(new THREE.Vector3(pos.x, model.hitHeight, pos.z), def.color, def.radius * 1.5);
  }

  /** 보스가 부하를 불러낸다. 남은 적 수(total)도 늘어난다. */
  private summon(e: Enemy): void {
    const s = e.def.summon!;
    const def = ENEMY_MAP[s.enemy];
    for (let i = 0; i < s.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = e.def.radius + 1 + Math.random();
      this.spawnEnemy(def, new THREE.Vector3(e.pos.x + Math.cos(a) * d, 0, e.pos.z + Math.sin(a) * d));
    }
    this.total += s.count;
    this.effects.explosion(this.hitPoint(e), 1.5, e.def.color);
  }

  // ─── 로봇 ──────────────────────────────────────────────

  private updateRobot(dt: number): void {
    const s = this.stats;
    if (s.repair > 0) this.hp = Math.min(s.maxHp, this.hp + s.repair * dt);
    if (s.shield > 0 && this.elapsed - this.lastHitAt >= ROBOT_SHIELD_DELAY) {
      this.shield = Math.min(s.shield, this.shield + s.shieldRegen * dt);
    }
    if (this.shieldBubble) {
      this.shieldPulse = Math.max(0, this.shieldPulse - dt * 4);
      const ratio = this.shield / s.shield;
      this.shieldBubble.visible = ratio > 0.02;
      (this.shieldBubble.material as THREE.MeshBasicMaterial).opacity = 0.05 + ratio * 0.15 + this.shieldPulse * 0.3;
    }

    const g = this.robot.group;
    const p = g.position;
    const nearest = this.nearestEnemy(p);
    let moving = false;

    if (nearest) {
      const toEnemy = new THREE.Vector3(nearest.pos.x - p.x, 0, nearest.pos.z - p.z);
      const d = toEnemy.length() - nearest.def.radius;
      const dirTo = toEnemy.normalize();
      const move = new THREE.Vector3();
      if (this.moveChip === 'hold') {
        // 고수: 중앙으로 돌아가기만 하고 적에게 반응해 움직이지 않는다
        if (Math.hypot(p.x, p.z) > 0.5) move.set(-p.x, 0, -p.z);
      } else if (this.moveChip === 'charge') {
        if (d > this.preferredRange) move.copy(dirTo);
      } else {
        // 카이팅: 너무 가까우면 후퇴, 너무 멀면 접근
        if (d < this.preferredRange * 0.7) move.copy(dirTo).negate();
        else if (d > this.preferredRange) move.copy(dirTo);
      }

      const r = Math.hypot(p.x, p.z);
      const edge = this.arena.radius - 3;
      if (r > edge && move.lengthSq() > 0) {
        // 가장자리에 몰리면 접선 방향으로 빠져나가며 중심 쪽으로 당긴다
        const inward = new THREE.Vector3(-p.x / r, 0, -p.z / r);
        const tangent = new THREE.Vector3(-inward.z, 0, inward.x);
        if (tangent.dot(move) < 0) tangent.negate();
        move.addScaledVector(tangent, 0.8).addScaledVector(inward, (r - edge) * 0.8);
      }
      if (move.lengthSq() > 1e-4) {
        const speed = this.stats.speed * (this.moveChip === 'charge' ? MOVE_EFFECTS.chargeSpeed : 1);
        p.addScaledVector(move.normalize(), speed * dt);
        moving = true;
      }
      g.rotation.y = lerpAngle(g.rotation.y, Math.atan2(dirTo.x, dirTo.z), Math.min(1, dt * 8));
    }

    const r = Math.hypot(p.x, p.z);
    const maxR = this.arena.radius - 1;
    if (r > maxR) p.multiplyScalar(maxR / r);

    this.walkAmount += ((moving ? 1 : 0) - this.walkAmount) * Math.min(1, dt * 8);
    if (moving) this.walkPhase += dt * 9;
    this.robot.animateWalk(this.walkPhase, this.walkAmount);
    g.updateMatrixWorld(true);
    this.robotMoving = moving;
  }

  // ─── 이동 칩 능력 ──────────────────────────────────────

  /** 카이팅은 움직이는 동안 연사가 느려진다 */
  private fireRateMult(): number {
    return this.moveChip === 'kite' && this.robotMoving ? MOVE_EFFECTS.kiteMovingFireRate : 1;
  }

  /** 고수는 멈춰 있는 동안 사거리가 늘어난다 */
  private rangeOf(w: WeaponDef): number {
    return w.range * (this.moveChip === 'hold' && !this.robotMoving ? MOVE_EFFECTS.holdRange : 1);
  }

  private damageRobot(amount: number): void {
    if (this.finished) return;
    // 고수: 멈춰 버티는 동안 받는 피해 감소
    if (this.moveChip === 'hold' && !this.robotMoving) amount *= MOVE_EFFECTS.holdDamageTaken;
    this.lastHitAt = this.elapsed;
    if (this.robotAcc.timer <= 0) this.robotAcc.timer = NUMBER_WINDOW;
    this.robotAcc.raw += amount;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      this.robotAcc.shield += absorbed;
      amount -= absorbed;
      this.shieldPulse = 1;
      this.sfx.play('shieldHit');
      if (amount <= 0) return;
    }
    this.hp -= amount;
    this.robotAcc.hp += amount;
    this.robotFlash = 1;
    this.sfx.play('robotHit');
    this.arena.addShake(Math.min(0.3, amount * 0.012));
    if (this.hp <= 0) {
      this.hp = 0;
      this.robotDead = true;
      const pos = this.robot.group.position;
      this.effects.explosion(new THREE.Vector3(pos.x, ROBOT_CHEST_Y, pos.z), 3.5, 0xffaa44);
      this.sfx.play('bigExplosion');
      this.arena.addShake(1.2);
      // 파괴 애니메이션이 있는 모델은 쓰러지는 모습을 보여 주고, 없으면 폭발과 함께 사라진다
      if (!this.robot.playSpecial('death')) this.robot.group.visible = false;
      this.finish(false);
    }
  }

  // ─── 무기 ──────────────────────────────────────────────

  private updateWeapons(dt: number): void {
    const p = this.robot.group.position;
    for (const w of this.weapons) {
      w.recoil = Math.max(0, w.recoil - dt * 6);
      w.mesh.position.z = -w.recoil * 0.25;
      const muzzlePos = w.muzzle.getWorldPosition(new THREE.Vector3());

      if (w.def.fireMode === 'beam' || w.def.fireMode === 'flame') {
        this.updateBeam(w, muzzlePos, dt);
        continue;
      }

      w.cooldown -= dt * this.fireRateMult();
      if (w.cooldown > 0) continue;
      const targets = this.enemiesInRange(p, w.def, w.def.burst);
      if (targets.length === 0) {
        w.cooldown = 0;
        continue;
      }
      w.cooldown = 1 / w.def.fireRate;
      w.recoil = 1;

      switch (w.def.fireMode) {
        case 'bullet':
          this.fireBullet(w.def, muzzlePos, targets[0]);
          break;
        case 'missile':
          // 서로 다른 적에게 한 발씩만 쏜다: 적이 적으면 미사일도 적게 나간다 (광역 무기의 약점)
          for (const t of targets) this.fireMissile(w.def, muzzlePos, t);
          break;
        case 'rail':
          this.fireRail(w.def, muzzlePos, targets[0]);
          break;
        case 'mortar':
          this.fireMortar(w.def, muzzlePos, targets[0]);
          break;
        case 'flak':
          this.fireFlak(w.def, muzzlePos, targets[0]);
          break;
        case 'gauss':
          this.fireGauss(w.def, muzzlePos, targets[0]);
          break;
        case 'emp':
          this.fireEmp(w.def);
          break;
      }
    }
  }

  /** 가우스 캐논: 목표 방향으로 사거리 끝까지 일직선 관통. 선 위의 지상 적을 가까운 순으로 모두 맞힌다. */
  private fireGauss(def: WeaponDef, from: THREE.Vector3, target: Enemy): void {
    const p = this.robot.group.position;
    const dir = new THREE.Vector3(target.pos.x - p.x, 0, target.pos.z - p.z).normalize();
    const range = this.rangeOf(def);
    const line = def.lineShot ?? { width: 1, falloff: 0 };
    const hits: { e: Enemy; along: number }[] = [];
    for (const e of this.enemies) {
      if (!e.alive || e.def.flying) continue;
      const rel = new THREE.Vector3(e.pos.x - p.x, 0, e.pos.z - p.z);
      const along = rel.dot(dir);
      if (along < 0 || along > range + e.def.radius) continue;
      const side = rel.addScaledVector(dir, -along).length();
      if (side <= line.width + e.def.radius) hits.push({ e, along });
    }
    hits.sort((a, b) => a.along - b.along);
    hits.forEach((h, i) => this.damageEnemy(h.e, def.damage * Math.pow(1 - line.falloff, i), def.damageType, def.pierce));

    const end = new THREE.Vector3(p.x + dir.x * range, from.y, p.z + dir.z * range);
    this.effects.beam(from, end, def.color, 0.25, 0.4);
    this.effects.beam(from, end, 0xffffff, 0.08, 0.25);
    this.effects.flash(from, def.color, 0.8);
    for (const h of hits) this.effects.sparks(this.hitPoint(h.e), def.color, 6);
    this.arena.addShake(0.25);
    this.sfx.play('rail');
  }

  /** EMP: 로봇 주변 반경 안의 모든 적(공중 포함)에게 에너지 피해와 기절. 보스는 기절 시간 절반. */
  private fireEmp(def: WeaponDef): void {
    const p = this.robot.group.position;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) - e.def.radius > def.aoeRadius) continue;
      this.damageEnemy(e, def.damage, def.damageType, def.pierce);
      if (e.alive && def.stun) e.stun = Math.max(e.stun, e.def.boss ? def.stun / 2 : def.stun);
    }
    this.effects.shockwave(new THREE.Vector3(p.x, 1.2, p.z), def.aoeRadius, def.color);
    this.arena.addShake(0.15);
    this.sfx.play('shieldHit');
  }

  /** 포물선을 그리며 날아가 지면에 떨어지는 포탄. 발사 순간의 적 위치를 노리므로 빠른 적은 빗나가기 쉽다. */
  private fireMortar(def: WeaponDef, from: THREE.Vector3, target: Enemy): void {
    const mesh = new THREE.Mesh(enemyShotGeo, projectileMat(def.color));
    mesh.position.copy(from);
    this.arena.scene.add(mesh);
    const to = new THREE.Vector3(target.pos.x, 0.1, target.pos.z);
    const dist = from.distanceTo(to);
    this.projectiles.push({
      kind: 'mortar',
      layer: 'ground',
      arc: { from: from.clone(), to, t: 0, duration: dist / def.projectileSpeed, height: Math.max(4, dist * 0.45) },
      mesh,
      vel: new THREE.Vector3(),
      speed: def.projectileSpeed,
      target: null,
      aim: to,
      weapon: def,
      damage: def.damage,
      life: 10,
      trail: 0,
      done: false,
    });
    this.effects.flash(from, def.color, 0.5);
    this.arena.addShake(0.05);
    this.sfx.play('missile');
  }

  private fireFlak(def: WeaponDef, from: THREE.Vector3, target: Enemy): void {
    const mesh = new THREE.Mesh(bulletGeo, projectileMat(def.color));
    mesh.scale.setScalar(1.6);
    mesh.position.copy(from);
    this.arena.scene.add(mesh);
    const aim = this.hitPoint(target);
    this.projectiles.push({
      kind: 'flak',
      layer: 'air',
      mesh,
      vel: aim.clone().sub(from).normalize().multiplyScalar(def.projectileSpeed),
      speed: def.projectileSpeed,
      target,
      aim,
      weapon: def,
      damage: def.damage,
      life: 2,
      trail: 0,
      done: false,
    });
    this.effects.flash(from, def.color, 0.3);
    this.sfx.play('autocannon');
  }

  /** 반경 안의 적에게 광역 피해. layer로 지상/공중을 가린다. */
  private splash(at: THREE.Vector3, w: WeaponDef, damage: number, layer: TargetLayer): void {
    for (const e of this.enemies) {
      if (!e.alive || !layerMatches(layer, e)) continue;
      const d = Math.hypot(e.pos.x - at.x, e.pos.z - at.z) - e.def.radius;
      if (d > w.aoeRadius) continue;
      const falloff = 1 - (0.5 * Math.max(0, d)) / w.aoeRadius;
      this.damageEnemy(e, damage * falloff, w.damageType, w.pierce);
    }
  }

  /** 화염방사기: 조준한 적 방향의 부채꼴 안에 있는 지상 적 모두에게 피해와 화상 */
  private flameTick(w: WeaponState, aimAt: Enemy): void {
    const p = this.robot.group.position;
    const dir = Math.atan2(aimAt.pos.x - p.x, aimAt.pos.z - p.z);
    const half = ((w.def.coneAngle ?? 40) * Math.PI) / 360;
    for (const e of this.enemies) {
      if (!e.alive || e.def.flying) continue;
      if (this.distanceTo(p, e) > this.rangeOf(w.def)) continue;
      let diff = Math.atan2(e.pos.x - p.x, e.pos.z - p.z) - dir;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > half + Math.atan2(e.def.radius, Math.max(0.5, this.distanceTo(p, e)))) continue;
      this.damageEnemy(e, w.def.damage, w.def.damageType, w.def.pierce);
      if (w.def.burn && e.alive) {
        e.burn = Math.max(e.burn, w.def.burn.duration);
        e.burnDps = Math.max(e.burnDps, w.def.burn.dps);
      }
    }
  }

  private fireBullet(def: WeaponDef, from: THREE.Vector3, target: Enemy): void {
    const mesh = new THREE.Mesh(bulletGeo, projectileMat(def.color));
    mesh.position.copy(from);
    this.arena.scene.add(mesh);
    const aim = this.hitPoint(target);
    this.projectiles.push({
      kind: 'bullet',
      layer: 'both',
      mesh,
      vel: aim.clone().sub(from).normalize().multiplyScalar(def.projectileSpeed),
      speed: def.projectileSpeed,
      target,
      aim,
      weapon: def,
      damage: def.damage,
      life: 2,
      trail: 0,
      done: false,
    });
    this.effects.flash(from, def.color, 0.25);
    this.sfx.play('autocannon');
  }

  private fireMissile(def: WeaponDef, from: THREE.Vector3, target: Enemy): void {
    const mesh = new THREE.Mesh(missileGeo, projectileMat(def.color));
    mesh.position.copy(from);
    this.arena.scene.add(mesh);
    const aim = this.hitPoint(target);
    const dir = aim.clone().sub(from).setY(0).normalize();
    // 위로 솟구쳤다가 목표로 휘어 들어가도록 초기 속도를 준다
    const vel = dir
      .multiplyScalar(0.4)
      .add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 1, (Math.random() - 0.5) * 0.8))
      .normalize()
      .multiplyScalar(def.projectileSpeed * 0.6);
    this.projectiles.push({
      kind: 'missile',
      // 폭발은 노린 적과 같은 층(지상/공중)에만 번진다
      layer: target.def.flying ? 'air' : 'ground',
      mesh,
      vel,
      speed: def.projectileSpeed,
      target,
      aim,
      weapon: def,
      damage: def.damage,
      life: 4,
      trail: 0,
      done: false,
    });
    this.sfx.play('missile');
  }

  private fireRail(def: WeaponDef, from: THREE.Vector3, target: Enemy): void {
    const hit = this.hitPoint(target);
    this.effects.beam(from, hit, def.color, 0.14, 0.3);
    this.effects.beam(from, hit, 0xffffff, 0.05, 0.18);
    this.effects.flash(from, def.color, 0.5);
    this.effects.sparks(hit, def.color, 8);
    this.arena.addShake(0.12);
    this.sfx.play('rail');
    this.damageEnemy(target, def.damage, def.damageType, def.pierce);
  }

  /** 끊김 없이 쏘는 무기: 레이저(단일 빔)와 화염방사기(부채꼴) */
  private updateBeam(w: WeaponState, from: THREE.Vector3, dt: number): void {
    const flame = w.def.fireMode === 'flame';
    const p = this.robot.group.position;
    let t = w.beamTarget;
    if (!t || !t.alive || this.distanceTo(p, t) > this.rangeOf(w.def)) {
      t = this.enemiesInRange(p, w.def, 1)[0] ?? null;
    }
    w.beamTarget = t;
    if (!t) {
      if (w.beam) w.beam.visible = false;
      w.cooldown = Math.max(0, w.cooldown - dt);
      return;
    }

    const hit = this.hitPoint(t);
    if (w.beam) {
      w.beam.visible = true;
      setBeam(w.beam, from, hit, 0.06 + Math.random() * 0.03);
    }
    if (flame) this.effects.flame(from, hit, w.def.range);
    w.cooldown -= dt * this.fireRateMult();
    while (w.cooldown <= 0 && t.alive) {
      if (flame) this.flameTick(w, t);
      else this.damageEnemy(t, w.def.damage, w.def.damageType, w.def.pierce);
      w.cooldown += 1 / w.def.fireRate;
    }
    if (w.cooldown < 0) w.cooldown = 0;
    if (flame) {
      this.sfx.play('flame');
      return;
    }
    if (Math.random() < dt * 20) this.effects.sparks(hit, w.def.color, 2);
    this.sfx.play('laser');
  }

  // ─── 적 ────────────────────────────────────────────────

  private damageEnemy(e: Enemy, amount: number, type: DamageType, pierce: number): void {
    if (!e.alive) return;
    // 돌격: 가까운 적에게 주는 피해 증가
    if (this.moveChip === 'charge' && this.distanceTo(this.robot.group.position, e) <= MOVE_EFFECTS.chargeRange) {
      amount *= MOVE_EFFECTS.chargeDamage;
    }
    const hadShield = e.shield > 0;
    const dealt = applyDamage(e, e.def.armor, amount, type, pierce);
    e.acc.shield += dealt.shield;
    e.acc.hp += dealt.hp;
    e.acc.raw += amount;
    if (e.acc.timer <= 0) e.acc.timer = NUMBER_WINDOW;
    e.flash = 0.08;
    if (hadShield) e.shieldPulse = 1;
    this.sfx.play(hadShield ? 'shieldHit' : 'hit');
    if (e.hp <= 0) this.killEnemy(e);
  }

  /** 모아 둔 피해를 숫자 하나로 띄운다. 효율이 낮으면(장갑에 막힘 등) 회색으로 표시해 상성을 알려 준다. */
  private flushEnemyNumber(e: Enemy): void {
    const a = e.acc;
    const total = a.shield + a.hp;
    if (this.numbers && a.raw > 0) {
      const efficiency = total / a.raw;
      const kind: NumberKind =
        total >= 60 ? 'big' : a.hp < 0.01 && a.shield > 0 ? 'shield' : efficiency < 0.4 ? 'weak' : 'normal';
      this.numbers.spawn(new THREE.Vector3(e.pos.x, e.model.barHeight + 0.2, e.pos.z), total, kind);
    }
    e.acc = newAcc();
  }

  private flushRobotNumber(): void {
    const p = this.robot.group.position;
    this.numbers?.spawn(new THREE.Vector3(p.x, 3.6, p.z), this.robotAcc.hp + this.robotAcc.shield, 'player');
    this.robotAcc = newAcc();
  }

  private killEnemy(e: Enemy): void {
    e.alive = false;
    this.killed++;
    this.flushEnemyNumber(e);
    const big = e.def.radius > 1;
    this.effects.explosion(this.hitPoint(e), e.def.radius * 1.6, big ? 0xffaa44 : e.def.color);
    this.sfx.play(big ? 'bigExplosion' : 'explosion');
    this.arena.addShake(big ? 0.5 : 0.05);
    this.removeEnemy(e);
  }

  private removeEnemy(e: Enemy): void {
    this.arena.scene.remove(e.model.group);
    e.model.dispose();
    this.arena.scene.remove(e.bar.group);
    e.bar.dispose();
  }

  private updateEnemies(dt: number): void {
    const rp = this.robot.group.position;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const def = e.def;
      const to = new THREE.Vector3(rp.x - e.pos.x, 0, rp.z - e.pos.z);
      const d = to.length();
      const reach = def.attackRange + def.radius + ROBOT.radius;
      if (d > 1e-4) to.divideScalar(d);

      // 기절: 이동·공격·실드 재생·소환이 멈춘다
      const stunned = e.stun > 0;
      if (stunned) {
        e.stun -= dt;
        if (Math.random() < dt * 10) this.effects.sparks(this.hitPoint(e), 0x7aa8ff, 1);
      }

      if (!stunned && !this.robotDead && d > reach * 0.9) e.pos.addScaledVector(to, def.speed * dt);
      const turnRate = def.model === 'tank' || def.model === 'juggernaut' ? 2.5 : 8;
      if (!stunned) {
        e.model.group.rotation.y = lerpAngle(e.model.group.rotation.y, Math.atan2(to.x, to.z), Math.min(1, dt * turnRate));
      }

      if (!stunned) e.cooldown -= dt;
      if (!stunned && !this.finished && d <= reach && e.cooldown <= 0) {
        e.cooldown = def.attackCooldown;
        this.enemyAttack(e);
      }

      if (!e.alive) continue; // 자폭했으면 여기서 끝
      if (e.maxShield > 0 && !stunned) e.shield = Math.min(e.maxShield, e.shield + def.shieldRegen * this.hpScale * dt);

      // 화상: 장갑·실드를 무시하는 지속 피해, 타는 동안 재생 정지
      if (e.burn > 0) {
        e.burn -= dt;
        const dmg = e.burnDps * dt;
        e.hp -= dmg;
        e.acc.hp += dmg;
        e.acc.raw += dmg;
        if (e.acc.timer <= 0) e.acc.timer = NUMBER_WINDOW;
        if (Math.random() < dt * 8) this.effects.sparks(this.hitPoint(e), 0xff6a1a, 1);
        if (e.hp <= 0) {
          this.killEnemy(e);
          continue;
        }
      } else if (def.hpRegen && e.hp < e.maxHp) {
        e.hp = Math.min(e.maxHp, e.hp + def.hpRegen * this.hpScale * dt);
        if (Math.random() < dt * 4) this.effects.sparks(this.hitPoint(e), 0x3ddc84, 1);
      }

      if (def.summon && !this.finished && !stunned) {
        e.summonTimer -= dt;
        if (e.summonTimer <= 0) {
          e.summonTimer = def.summon.interval;
          this.summon(e);
        }
      }

      // 연출
      if (e.acc.timer > 0) {
        e.acc.timer -= dt;
        if (e.acc.timer <= 0) this.flushEnemyNumber(e);
      }
      e.flash = Math.max(0, e.flash - dt);
      e.model.setFlash(e.flash > 0);
      e.model.update(dt);
      if (e.model.shield) {
        e.shieldPulse = Math.max(0, e.shieldPulse - dt * 4);
        const ratio = e.shield / e.maxShield;
        const mat = e.model.shield.material as THREE.MeshBasicMaterial;
        e.model.shield.visible = ratio > 0.02;
        mat.opacity = 0.08 + ratio * 0.25 + e.shieldPulse * 0.35;
        e.model.shield.scale.setScalar(1 + e.shieldPulse * 0.08);
      }
      if (def.flying || def.model === 'drone' || def.model === 'shielder') {
        e.model.body.position.y = e.model.bobBase + Math.sin(this.elapsed * 4 + e.phase) * (def.flying ? 0.3 : 0.12);
      }
      if (def.explode) {
        // 자폭 경고등 깜빡임 (가까울수록 빠르게)
        const beacon = e.model.group.getObjectByName('beacon');
        if (beacon) beacon.visible = Math.sin(this.elapsed * (d < 6 ? 30 : 10)) > 0;
      }
    }

    this.separateEnemies();
    for (const e of this.enemies) e.model.group.position.copy(e.pos);
    this.enemies = this.enemies.filter((e) => e.alive);
  }

  private enemyAttack(e: Enemy): void {
    const rp = this.robot.group.position;
    if (e.def.explode) {
      // 자폭: 로봇에게 큰 피해를 주고 스스로 사라진다
      this.effects.explosion(this.hitPoint(e), e.def.explode.radius, 0xff5a36);
      this.sfx.play('bigExplosion');
      this.arena.addShake(0.4);
      this.damageRobot(e.def.explode.damage);
      e.alive = false;
      this.killed++;
      this.removeEnemy(e);
      return;
    }
    if (!e.def.ranged) {
      this.damageRobot(e.def.attackDamage);
      this.effects.sparks(new THREE.Vector3(rp.x, 1.5, rp.z), 0xffaa55, 3);
      return;
    }
    const from = e.model.muzzle.getWorldPosition(new THREE.Vector3());
    const aim = new THREE.Vector3(rp.x, ROBOT_CHEST_Y, rp.z);
    // 전차류는 크고 느린 주황 포탄, 나머지는 파란 에너지탄
    const heavy = e.def.model === 'tank' || e.def.model === 'juggernaut';
    const speed = heavy ? 18 : 14;
    const mesh = new THREE.Mesh(enemyShotGeo, projectileMat(heavy ? 0xff5522 : 0x7fd0ff));
    mesh.position.copy(from);
    if (heavy) mesh.scale.setScalar(e.def.model === 'juggernaut' ? 2 : 1.5);
    this.arena.scene.add(mesh);
    this.projectiles.push({
      kind: 'enemy',
      layer: 'both',
      mesh,
      vel: aim.clone().sub(from).normalize().multiplyScalar(speed),
      speed,
      target: null,
      aim,
      weapon: null,
      damage: e.def.attackDamage,
      life: 3,
      trail: 0,
      done: false,
    });
    this.effects.flash(from, 0xffaa55, heavy ? 0.6 : 0.3);
    if (heavy) this.arena.addShake(0.05);
    this.sfx.play('enemyShot');
  }

  /** 적끼리, 적과 로봇이 겹치지 않게 밀어낸다 (반경² 비례 질량). */
  private separateEnemies(): void {
    const list = this.enemies;
    const rp = this.robot.group.position;
    const maxR = this.arena.radius - 0.5;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        // 공중과 지상은 서로 밀어내지 않는다
        if (!b.alive || !!a.def.flying !== !!b.def.flying) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const min = a.def.radius + b.def.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const overlap = min - d;
        const ma = a.def.radius ** 2;
        const mb = b.def.radius ** 2;
        const nx = dx / d;
        const nz = dz / d;
        a.pos.x -= nx * overlap * (mb / (ma + mb));
        a.pos.z -= nz * overlap * (mb / (ma + mb));
        b.pos.x += nx * overlap * (ma / (ma + mb));
        b.pos.z += nz * overlap * (ma / (ma + mb));
      }
      if (!this.robotDead && !a.def.flying) {
        const dx = a.pos.x - rp.x;
        const dz = a.pos.z - rp.z;
        const min = a.def.radius + ROBOT.radius;
        const d = Math.hypot(dx, dz);
        if (d < min && d > 1e-4) {
          a.pos.x = rp.x + (dx / d) * min;
          a.pos.z = rp.z + (dz / d) * min;
        }
      }
      const r = Math.hypot(a.pos.x, a.pos.z);
      if (r > maxR) a.pos.multiplyScalar(maxR / r);
    }
  }

  private updateBars(): void {
    const q = this.arena.camera.quaternion;
    for (const e of this.enemies) {
      const damaged = e.hp < e.maxHp || (e.maxShield > 0 && e.shield < e.maxShield - 0.5);
      e.bar.group.visible = damaged;
      if (!damaged) continue;
      e.bar.group.position.set(e.pos.x, e.model.barHeight, e.pos.z);
      e.bar.group.quaternion.copy(q);
      e.bar.set(e.hp / e.maxHp, e.maxShield > 0 ? e.shield / e.maxShield : 0);
    }
  }

  // ─── 투사체 ────────────────────────────────────────────

  private updateProjectiles(dt: number): void {
    const rp = this.robot.group.position;
    for (const pr of this.projectiles) {
      pr.life -= dt;
      if (pr.arc) {
        // 박격포: 정해진 지점으로 포물선 비행
        const a = pr.arc;
        a.t += dt / a.duration;
        if (a.t >= 1) {
          pr.mesh.position.copy(a.to);
          this.impact(pr);
          continue;
        }
        pr.mesh.position.lerpVectors(a.from, a.to, a.t);
        pr.mesh.position.y += Math.sin(a.t * Math.PI) * a.height;
        pr.trail -= dt;
        if (pr.trail <= 0) {
          pr.trail = 0.05;
          this.effects.smoke(pr.mesh.position);
        }
        continue;
      }
      if (pr.kind === 'enemy') {
        if (!this.robotDead) pr.aim.set(rp.x, ROBOT_CHEST_Y, rp.z);
      } else if (pr.target?.alive) {
        pr.aim.copy(this.hitPoint(pr.target));
      }

      const toAim = new THREE.Vector3().subVectors(pr.aim, pr.mesh.position);
      const dist = toAim.length();
      if (pr.kind === 'missile') {
        pr.vel.lerp(toAim.clone().normalize().multiplyScalar(pr.speed), Math.min(1, dt * 3.5));
        pr.trail -= dt;
        if (pr.trail <= 0) {
          pr.trail = 0.03;
          this.effects.smoke(pr.mesh.position);
        }
      } else {
        pr.vel.copy(toAim).normalize().multiplyScalar(pr.speed);
      }

      const stepLen = pr.vel.length() * dt;
      if (dist <= stepLen + (pr.kind === 'missile' || pr.kind === 'flak' ? 0.4 : 0.25) || pr.life <= 0) {
        pr.mesh.position.copy(pr.aim);
        this.impact(pr);
        continue;
      }
      pr.mesh.position.addScaledVector(pr.vel, dt);
      if (pr.kind === 'missile') pr.mesh.lookAt(pr.mesh.position.clone().add(pr.vel));
    }

    const alive: Projectile[] = [];
    for (const pr of this.projectiles) {
      if (pr.done) this.arena.scene.remove(pr.mesh);
      else alive.push(pr);
    }
    this.projectiles = alive;
  }

  private impact(pr: Projectile): void {
    pr.done = true;
    const at = pr.mesh.position;
    switch (pr.kind) {
      case 'bullet':
        this.effects.sparks(at, pr.weapon!.color, 3);
        if (pr.target?.alive) this.damageEnemy(pr.target, pr.damage, pr.weapon!.damageType, pr.weapon!.pierce);
        break;
      case 'missile':
      case 'mortar':
      case 'flak': {
        const w = pr.weapon!;
        this.effects.explosion(at, w.aoeRadius * (pr.kind === 'mortar' ? 0.9 : 0.7), w.color);
        this.sfx.play(pr.kind === 'mortar' ? 'bigExplosion' : 'explosion');
        this.arena.addShake(pr.kind === 'mortar' ? 0.2 : 0.06);
        this.splash(at, w, pr.damage, pr.layer);
        break;
      }
      case 'enemy': {
        const rp = this.robot.group.position;
        this.effects.sparks(at, 0xffaa55, 4);
        if (!this.robotDead && Math.hypot(at.x - rp.x, at.z - rp.z) < 1.8) this.damageRobot(pr.damage);
        break;
      }
    }
  }

  // ─── 조회 도우미 ───────────────────────────────────────

  private hitPoint(e: Enemy): THREE.Vector3 {
    return new THREE.Vector3(e.pos.x, e.model.hitHeight, e.pos.z);
  }

  /** 로봇에서 적 표면까지의 수평 거리 */
  private distanceTo(p: THREE.Vector3, e: Enemy): number {
    return Math.hypot(e.pos.x - p.x, e.pos.z - p.z) - e.def.radius;
  }

  private nearestEnemy(p: THREE.Vector3): Enemy | null {
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = this.distanceTo(p, e);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** 무기가 노릴 수 있는 적(사거리·최소 사거리·지상/공중)을 타겟 칩 우선순위대로 max개 고른다 (동률이면 가까운 순). */
  private enemiesInRange(p: THREE.Vector3, w: WeaponDef, max: number): Enemy[] {
    const list: { e: Enemy; d: number; key: number }[] = [];
    const minRange = w.minRange ?? 0;
    for (const e of this.enemies) {
      if (!e.alive || !layerMatches(w.targets, e)) continue;
      const d = this.distanceTo(p, e);
      if (d <= this.rangeOf(w) && d >= minRange) list.push({ e, d, key: this.priorityKey(e) });
    }
    list.sort((a, b) => a.key - b.key || a.d - b.d);
    return list.slice(0, max).map((x) => x.e);
  }

  /** 작을수록 먼저 조준한다 */
  private priorityKey(e: Enemy): number {
    switch (this.targetChip) {
      case 'strongest':
        return -(e.hp + e.shield);
      case 'weakest':
        return e.hp + e.shield;
      case 'shielded':
        return e.shield > 0 ? 0 : 1;
      default:
        return 0;
    }
  }
}
