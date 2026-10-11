// Copies the OCR engine (tesseract.js worker and WebAssembly core) next to the bundled
// language data, so text recognition runs fully offline. Runs before dev and build.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const out = join(import.meta.dirname, '../public/ocr');
mkdirSync(join(out, 'core'), { recursive: true });

const tessDist = join(dirname(require.resolve('tesseract.js/package.json')), 'dist');
copyFileSync(join(tessDist, 'worker.min.js'), join(out, 'worker.min.js'));

const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
for (const f of readdirSync(coreDir)) {
  if (/^tesseract-core.*\.(wasm\.js|wasm|js)$/.test(f)) copyFileSync(join(coreDir, f), join(out, 'core', f));
}
console.log('OCR engine copied to public/ocr');
