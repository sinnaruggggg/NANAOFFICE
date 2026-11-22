import { defineConfig } from 'vite';
import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
function pdfResources() {
  let output;
  return {
    name: 'offline-pdf-resources',
    apply: 'build',
    configResolved(config) { output = resolve(config.root,config.build.outDir,'pdf-assets'); },
    async closeBundle() {
      await mkdir(output,{recursive:true});
      await Promise.all(['cmaps','standard_fonts','wasm','iccs','LICENSE'].map(name =>
        cp(join(pdfRoot,name),join(output,name),{recursive:true})));
    },
  };
}
export default defineConfig({ base:'./', build:{target:'chrome100'}, plugins:[pdfResources()] });
