const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { distribution,verifyArchive } = require('../desktop/office.cjs');

async function stageOffice() {
  const dir = path.resolve(__dirname,'../.office-build');
  await fs.mkdir(dir,{recursive:true});
  const archive = path.join(dir,distribution.name);
  try { await verifyArchive(archive); return; } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const stage = await fs.mkdtemp(path.join(dir,'archive-'));
  const staged = path.join(stage,distribution.name);
  try {
    if (process.env.NANAOFFICE_ENGINE_ARCHIVE) {
      await fs.copyFile(process.env.NANAOFFICE_ENGINE_ARCHIVE,staged);
    } else {
      const response = await fetch(distribution.url,{signal:AbortSignal.timeout(10*60*1000)});
      if (!response.ok || !response.body) throw Error('공식 오피스 편집기 패키지를 내려받지 못했습니다.');
      await pipeline(Readable.fromWeb(response.body),createWriteStream(staged,{flags:'wx'}));
    }
    await verifyArchive(staged);
    await fs.rename(staged,archive);
  } finally { await fs.rm(stage,{recursive:true,force:true}); }
}

stageOffice().catch(error => { console.error(error); process.exitCode = 1; });
