const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const exec = promisify(execFile);
const release = 'https://github.com/ONLYOFFICE/DesktopEditors/releases/download/v10.0.0/DesktopEditors_x64.zip';
const sha = '54979d04f1cdca56deb0c62e0356355a45f392cdb54f04f6b7e436b1f44c3605';
const size = 397286158;

async function prepareOffice(local, progress) {
  const location = path.join(local, 'DeskEditRoom', 'engines', 'onlyoffice-10.0.0-x64');
  const executable = path.join(location, 'DesktopEditors.exe');
  if (fs.existsSync(executable)) return executable;
  const base = path.join(local, 'NANAOFFICE', 'engines');
  const installed = path.join(base, 'onlyoffice-10.0.0-x64');
  const alternate = path.join(installed, 'DesktopEditors.exe');
  if (fs.existsSync(alternate)) return alternate;
  const permission = require('electron').dialog.showMessageBoxSync({
    type:'question', buttons:['다운로드','취소'], cancelId:1,
    title:'고급 편집기 설치', message:'고급 편집에 공식 편집기 다운로드(397 MB)가 필요합니다.',
  });
  if (permission !== 0) return null;
  await fsp.mkdir(base, {recursive:true});
  const stage = path.join(base, 'staging-' + randomUUID());
  await fsp.mkdir(stage);
  try {
    const archive = path.join(stage, 'official.zip');
    const files = path.join(stage, 'files');
    const response = await fetch(release, {signal:AbortSignal.timeout(20 * 60 * 1000)});
    if (!response.ok || !response.body) throw Error('공식 배포본을 내려받지 못했습니다.');
    const hash = createHash('sha256');
    let received = 0, percent = -1;
    await pipeline(Readable.fromWeb(response.body), new Transform({
      transform(chunk, _, done) {
        received += chunk.length;
        if (received > size) { done(Error('파일 크기가 공식 배포본과 다릅니다.')); return; }
        hash.update(chunk);
        const next = Math.floor(received * 100 / size);
        if (next !== percent) { progress('공식 편집기 다운로드 중… ' + next + '%'); percent = next; }
        done(null, chunk);
      },
    }), fs.createWriteStream(archive, {flags:'wx'}));
    if (received !== size || hash.digest('hex') !== sha) throw Error('공식 배포본의 SHA-256 값이 일치하지 않습니다.');
    await fsp.mkdir(files);
    progress('공식 편집기의 압축을 푸는 중…');
    await exec(path.join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-xf', archive, '-C', files], {windowsHide:true});
    if (!fs.existsSync(path.join(files,'DesktopEditors.exe'))) throw Error('편집기 실행 파일이 없습니다.');
    await fsp.rename(files, installed);
    return alternate;
  } finally { await fsp.rm(stage, {recursive:true, force:true}); }
}
module.exports = {prepareOffice};
