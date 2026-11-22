const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { prepareOffice } = require('./office.cjs');

const LINK = 'nanaoffice://local';
const LIMIT = 48 * 1024 * 1024;
const supported = /\.(?:hwp|hwpx|xlsx|pptx|pdf|docx|csv|tsv|txt|md)$/i;
protocol.registerSchemesAsPrivileged([{ scheme:'nanaoffice', privileges:{
  standard:true, secure:true, supportFetchAPI:true, corsEnabled:true,
}}]);
let window;
let queued = process.argv.find(arg => supported.test(arg));
const hiddenQA = process.env.NANAOFFICE_QA_HIDDEN === '1';
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_, args) => {
  if (window && !hiddenQA) { if (window.isMinimized()) window.restore(); window.focus(); }
  const file = args.find(arg => supported.test(arg));
  if (file) void receive(file);
});

async function receive(file) {
  try {
    if ((await fs.stat(file)).size > LIMIT) throw Error('48MB 이하의 파일을 선택하세요.');
    window.webContents.send('open-file', path.basename(file), new Uint8Array(await fs.readFile(file)));
  } catch (error) { window.webContents.send('advanced-progress', error.message); }
}

app.whenReady().then(async () => {
  const dist = path.resolve(__dirname, '../dist');
  protocol.handle('nanaoffice', async request => {
    const url = new URL(request.url);
    const filename = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (url.host !== 'local' || !filename.startsWith(dist + path.sep)) return new Response(null, { status: 404 });
    const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
      '.mjs':'text/javascript; charset=utf-8',
      '.css':'text/css; charset=utf-8', '.wasm':'application/wasm', '.png':'image/png' };
    try {
      return new Response(await fs.readFile(filename), { headers:{
        'Content-Type':types[path.extname(filename)] || 'application/octet-stream',
        'X-Content-Type-Options':'nosniff',
      }});
    } catch { return new Response(null, { status:404 }); }
  });
  session.defaultSession.webRequest.onBeforeRequest(({url}, callback) => {
    callback({ cancel: !url.startsWith(LINK + '/') && !url.startsWith('blob:' + LINK + '/') });
  });
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    title:'NANAOFFICE', width:1080, height:790, minWidth:375, minHeight:550, show:false,
    backgroundColor:'#f6f7f2',
    icon:path.join(dist, 'icon.png'),
    webPreferences:{ preload:path.join(__dirname, 'preload.cjs'), contextIsolation:true, sandbox:true, nodeIntegration:false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => { if (!hiddenQA) window.show(); });
  ipcMain.on('editor-ready', event => {
    if (event.sender !== window.webContents || !queued) return;
    const file = queued;
    queued = null;
    void receive(file);
  });
  function allowed(event) {
    if (event.sender !== window.webContents || event.senderFrame.url !== LINK + '/index.html') throw Error('지원하지 않는 요청입니다.');
  }
  ipcMain.handle('save-copy', async (event, name, bytes) => {
    allowed(event);
    if (typeof name !== 'string' || name !== path.basename(name) || !supported.test(name) ||
        !(bytes instanceof Uint8Array) || bytes.byteLength > 56 * 1024 * 1024) throw Error('파일 이름 또는 크기를 확인하세요.');
    const output = await dialog.showSaveDialog(window, { defaultPath:name, filters:[{ name:'문서', extensions:[name.split('.').pop()] }] });
    if (output.canceled || !output.filePath) return 'cancelled';
    if (path.extname(output.filePath).toLowerCase() !== path.extname(name)) throw Error('원본과 같은 확장자로 저장하세요.');
    const tmp = output.filePath + '.nana-' + require('node:crypto').randomUUID() + '.tmp';
    try { await fs.writeFile(tmp, bytes, {flag:'wx'}); await fs.rename(tmp, output.filePath); }
    finally { await fs.rm(tmp, {force:true}); }
    return 'saved';
  });
  ipcMain.handle('open-advanced', async event => {
    allowed(event);
    const start = await dialog.showMessageBox(window, {
      type:'question', title:'ONLYOFFICE', message:'어떤 작업을 시작할까요?',
      buttons:['기존 파일 열기','새 스프레드시트','새 프레젠테이션','취소'], cancelId:3,
    });
    if (start.response === 3) return;
    let argument = ['','--new:cell','--new:slide'][start.response];
    if (!argument) {
      const files = await dialog.showOpenDialog(window, { properties:['openFile'], filters:[{name:'엑셀과 파워포인트',extensions:['xlsx','pptx']}] });
      if (files.canceled) return;
      [argument] = files.filePaths;
    }
    const executable = await prepareOffice(process.env.LOCALAPPDATA || path.dirname(app.getPath('appData')),
      text => event.sender.send('advanced-progress', text));
    await new Promise((resolve, reject) => {
      const process = spawn(executable, [argument], { cwd:path.dirname(executable), detached:true, stdio:'ignore' });
      process.once('error', reject);
      process.once('spawn', () => { process.unref(); resolve(); });
    });
    event.sender.send('advanced-progress','ONLYOFFICE 편집 창을 열었습니다.');
  });
  await window.loadURL(LINK + '/index.html');
  if (hiddenQA) {
    await window.webContents.executeJavaScript("document.querySelector('.brand').textContent.trim()");
    console.log('NANAOFFICE_WINDOW_READY');
    app.quit();
  }
});
app.on('window-all-closed', () => app.quit());
