import { chromium } from '../../node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const FFMPEG = 'C:/Users/Oslem/AppData/Local/CapCut/Apps/9.5.0.4050/ffmpeg.exe';
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../../public');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const within = (base, p) => p === base || p.startsWith(base + path.sep);
const srv = http.createServer((q, r) => {
  const url = decodeURIComponent(q.url.split('?')[0]);
  // Yalnizca reklam klasoru ve repo public/ klasoru sunulur (kok dizin, .env vb. ASLA).
  const [base, rel] = url.startsWith('/public/') ? [publicDir, url.slice('/public/'.length)] : [here, url.slice(1)];
  const p = path.resolve(base, rel);
  if (!within(base, p) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(r);
}).listen(5201, '127.0.0.1');
const mode = process.argv[2] || 'stills';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto('http://127.0.0.1:5201/scene.html');
await p.evaluate(() => window.ready());
const grab = async t => {
  await p.evaluate(t => window.prepare(t), t);
  await p.evaluate(t => window.draw(t), t);
  return await p.screenshot({ type: 'jpeg', quality: 95 });
};
if (mode === 'stills') {
  fs.mkdirSync('stills', { recursive: true });
  for (const t of process.argv.slice(3).map(Number)) fs.writeFileSync(`stills/t${t}.jpg`, await grab(t));
} else {
  const FPS = 30, N = 30 * FPS;
  const ff = spawn(FFMPEG, ['-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-i', 'music.wav',
    '-c:v', 'h264_mf', '-b:v', '12M', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
    process.argv[3] || 'PerdePRO_Instagram_Reklam_v2.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < N; i++) {
    const buf = await grab(i / FPS);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
}
await b.close(); srv.close();
