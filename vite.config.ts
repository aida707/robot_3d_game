import { defineConfig, type Plugin } from 'vite';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 개발 서버 전용: public/models 아래의 glTF 파일 목록을 /__models 로 돌려준다 (모델 뷰어용) */
function modelList(): Plugin {
  return {
    name: 'model-list',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__models', (_req, res) => {
        const root = join(server.config.root, 'public');
        const out: string[] = [];
        const walk = (dir: string) => {
          let entries: string[] = [];
          try {
            entries = readdirSync(dir);
          } catch {
            return;
          }
          for (const name of entries) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else if (/\.(gltf|glb)$/i.test(name)) out.push(relative(root, full).split('\\').join('/'));
          }
        };
        walk(join(root, 'models'));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(out.sort()));
      });
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages는 https://aida707.github.io/robot_3d_game/ 처럼 하위 경로에서 서비스되므로
  // 빌드(와 빌드 결과를 띄우는 preview)에서만 기준 경로를 맞춘다. 개발 서버는 그대로 / 를 쓴다.
  // 에셋은 코드에서 import.meta.env.BASE_URL을 붙여 불러오므로 이 값만 바꾸면 된다.
  base: command === 'build' || isPreview ? '/robot_3d_game/' : '/',
  plugins: [modelList()],
}));
