const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

const version = '10.0.0';
const distribution = Object.freeze({
  version,
  name:'DesktopEditors_x64.zip',
  url:'https://github.com/ONLYOFFICE/DesktopEditors/releases/download/v'+version+'/DesktopEditors_x64.zip',
  size:397286158,
  sha:'54979d04f1cdca56deb0c62e0356355a45f392cdb54f04f6b7e436b1f44c3605',
});
const editors = new Map([['docx','--new:word'],['xlsx','--new:cell'],['pptx','--new:slide']]);
const officeFormat = filename => editors.has(path.extname(filename).slice(1).toLowerCase());

async function verifyArchive(archive) {
  if ((await fs.stat(archive)).size !== distribution.size) throw Error('오피스 편집기 패키지 크기가 일치하지 않습니다.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (hash.digest('hex') !== distribution.sha) throw Error('오피스 편집기 패키지의 확인 값이 일치하지 않습니다.');
}

function createOfficeLauncher({archive,cache,progress}) {
  const dir = path.join(cache,'onlyoffice-desktop-'+distribution.version+'-x64');
  const exe = path.join(dir,'DesktopEditors.exe');
  let preparing;

  async function prepare() {
    try { await fs.access(exe); return exe; } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    progress('오피스 편집기를 준비하는 중입니다. 처음 한 번만 진행합니다.');
    await verifyArchive(archive);
    await fs.mkdir(cache,{recursive:true});
    const stage = await fs.mkdtemp(path.join(cache,'office-'));
    try {
      const tar = path.join(process.env.SystemRoot,'System32','tar.exe');
      await promisify(execFile)(tar,['-xf',archive,'-C',stage],{windowsHide:true});
      await fs.access(path.join(stage,'DesktopEditors.exe'));
      try { await fs.rename(stage,dir); }
      catch (error) {
        if (!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code)) throw error;
        await fs.access(exe);
      }
      return exe;
    } finally { await fs.rm(stage,{recursive:true,force:true}); }
  }

  return async ({format,file}) => {
    const args = ['--lang:ko'];
    if (file !== undefined) {
      if (!path.isAbsolute(file) || !officeFormat(file) || !(await fs.stat(file)).isFile()) {
        throw Error('열 수 있는 오피스 문서가 아닙니다.');
      }
      args.push(file);
    } else if (editors.has(format)) args.push(editors.get(format));
    else if (format !== 'home') throw Error('지원하지 않는 오피스 문서입니다.');

    preparing ??= prepare().finally(() => { preparing = undefined; });
    const executable = await preparing;
    await new Promise((resolve,reject) => {
      const process = spawn(executable,args,{cwd:path.dirname(executable),detached:true,stdio:'ignore'});
      process.once('error',reject);
      process.once('spawn',() => { process.unref(); resolve(); });
    });
  };
}

module.exports = {distribution,officeFormat,verifyArchive,createOfficeLauncher};
