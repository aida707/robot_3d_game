// 에셋 파이프라인 테스트용 glb 생성기 (외부 다운로드 없이 로더·자동 크기 맞춤·애니메이션을 검증한다)
// 사용법: node scripts/make-test-model.mjs  →  public/models/test_drone.glb
import { writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// GLTFExporter가 바이너리 출력에 쓰는 FileReader를 Node용으로 흉내 낸다
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = 'data:application/octet-stream;base64,' + Buffer.from(buf).toString('base64');
      this.onloadend?.();
    });
  }
};

// 일부러 크게(지름 ~7) 만들고, 정면(노란 눈)이 -z를 향하게 하며, 'Walk' 회전 애니메이션을 넣는다
const root = new THREE.Group();
root.name = 'TestDrone';
const spinner = new THREE.Group();
spinner.name = 'Spinner';
root.add(spinner);
spinner.add(
  new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x33cc66, metalness: 0.3, roughness: 0.5, flatShading: true }),
  ),
);
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2;
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2, 6), new THREE.MeshStandardMaterial({ color: 0x225533 }));
  spike.position.set(Math.cos(a) * 3, 0, Math.sin(a) * 3);
  spike.rotation.set(0, -a, -Math.PI / 2);
  spinner.add(spike);
}
const eye = new THREE.Mesh(
  new THREE.SphereGeometry(0.6),
  new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffee00 }),
);
eye.position.set(0, 0.5, -2.4);
root.add(eye);

const q = (angle) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle).toArray();
const clip = new THREE.AnimationClip('Walk', 2, [
  new THREE.QuaternionKeyframeTrack('Spinner.quaternion', [0, 1, 2], [...q(0), ...q(Math.PI), ...q(Math.PI * 2 - 0.001)]),
]);

const glb = await new GLTFExporter().parseAsync(root, { binary: true, animations: [clip] });
mkdirSync('public/models', { recursive: true });
writeFileSync('public/models/test_drone.glb', Buffer.from(glb));
console.log('public/models/test_drone.glb', glb.byteLength, 'bytes');
