// 게임 아이콘 생성기: 외부 도구 없이 로봇 머리 아이콘을 그려 PNG와 ICO로 저장한다.
// 사용법: node scripts/make-icon.mjs
//   → public/favicon.png (브라우저 탭 아이콘)
//   → launcher/mech-tactics.ico (바탕화면 바로가기 아이콘, 16~256px 포함)
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// ─── 도형 (256×256 설계 좌표) ────────────────────────────

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** 설계 좌표 한 점의 색 [r,g,b,a] (위에 그린 것이 우선) */
function shade(x, y) {
  // 로봇 머리
  if (inCircle(x, y, 128, 40, 13)) return [...hex(0xff8a3d), 255]; // 안테나 끝
  if (x >= 123 && x <= 133 && y >= 44 && y <= 74) return [...hex(0x2a3038), 255]; // 안테나 대
  if (inRoundRect(x, y, 84, 112, 172, 142, 14)) {
    // 바이저: 위쪽이 밝은 청록
    const t = (y - 112) / 30;
    return [51 + 120 * (1 - t), 221, 255, 255];
  }
  for (let i = 0; i < 3; i++) {
    if (inRoundRect(x, y, 104 + i * 18, 158, 116 + i * 18, 176, 4)) return [...hex(0x2a3038), 255]; // 입 그릴
  }
  if (inRoundRect(x, y, 66, 72, 190, 196, 30)) {
    // 투구: 아래로 갈수록 어두워지는 금속색
    const t = (y - 72) / 124;
    const base = hex(0x8aa0b6);
    return [...base.map((c) => c * (1 - 0.35 * t)), 255];
  }
  if (inRoundRect(x, y, 44, 104, 70, 166, 8) || inRoundRect(x, y, 186, 104, 212, 166, 8)) {
    return [...hex(0x2a3038), 255]; // 양쪽 귀 장갑
  }
  // 경기장 링 (주황 원)
  const d = Math.hypot(x - 128, y - 136);
  if (d >= 98 && d <= 108) return [...hex(0xff8a3d), 255];
  // 배경: 둥근 사각형, 위가 약간 밝은 남색
  if (inRoundRect(x, y, 4, 4, 252, 252, 52)) {
    const t = y / 256;
    return [22 - 10 * t, 32 - 14 * t, 46 - 18 * t, 255];
  }
  return [0, 0, 0, 0];
}

/** size×size RGBA 이미지. 픽셀마다 4×4 표본으로 가장자리를 부드럽게 한다. */
function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 4;
  const k = 256 / size;
  for (let py = 0; py < size; py++) {
    for (let pxI = 0; pxI < size; pxI++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((pxI + (sx + 0.5) / ss) * k, (py + (sy + 0.5) / ss) * k);
          const alpha = c[3] / 255;
          r += c[0] * alpha;
          g += c[1] * alpha;
          b += c[2] * alpha;
          a += alpha;
        }
      }
      const i = (py * size + pxI) * 4;
      const n = ss * ss;
      px[i] = a ? Math.round(r / a) : 0;
      px[i + 1] = a ? Math.round(g / a) : 0;
      px[i + 2] = a ? Math.round(b / a) : 0;
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
}

// ─── PNG / ICO 인코더 ───────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // 필터 없음
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** PNG를 담은 ICO (Windows Vista 이상 지원) */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const sizes = [256, 64, 48, 32, 16];
const images = sizes.map((size) => ({ size, data: png(size, render(size)) }));

mkdirSync('public', { recursive: true });
mkdirSync('launcher', { recursive: true });
writeFileSync('public/favicon.png', images[1].data);
writeFileSync('launcher/mech-tactics.ico', ico(images));
console.log('public/favicon.png, launcher/mech-tactics.ico 생성');
