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

export default defineConfig({
  plugins: [modelList()],
});
