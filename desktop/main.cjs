const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { distribution, officeFormat, createOfficeLauncher } = require('./office.cjs');

const LINK = 'nanaoffice://local';
const LIMIT = 48 * 1024 * 1024;
const documentExtensions = ['hwp','hwpx','xlsx','pptx','pdf','docx','csv','tsv','txt','md'];
const supported = name => documentExtensions.includes(path.extname(name).slice(1).toLowerCase());
app.commandLine.appendSwitch('lang','ko');
protocol.registerSchemesAsPrivileged([{ scheme:'nanaoffice', privileges:{
  standard:true, secure:true, supportFetchAPI:true, corsEnabled:true,
}}]);
let window;
let launchOffice;
let rendererReady = false;
const queued = process.argv.filter(arg => path.isAbsolute(arg) && supported(arg));
const hiddenQA = process.env.NANAOFFICE_QA_HIDDEN === '1';
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_, args) => {
  if (window && !hiddenQA) { if (window.isMinimized()) window.restore(); window.focus(); }
  for (const file of args.filter(arg => path.isAbsolute(arg) && supported(arg))) {
    if (rendererReady) void receive(file);
    else queued.push(file);
  }
});

async function openNative(request) {
  try {
    await launchOffice(request);
    return {opened:true};
  } catch (error) {
    console.error(error);
    return {error:'오피스 편집기를 열지 못했습니다. 파일과 설치 상태를 확인하세요.'};
  }
}

async function receive(file) {
  if (officeFormat(file)) {
    const result = await openNative({file});
    if (!window.isDestroyed()) window.webContents.send('office-result',result);
    return;
  }
  try {
    if ((await fs.stat(file)).size > LIMIT) throw Error('48MB 이하의 파일을 선택하세요.');
    window.webContents.send('open-file', path.basename(file), new Uint8Array(await fs.readFile(file)));
  } catch (error) {
    console.error(error);
    window.webContents.send('advanced-progress','파일을 읽지 못했습니다. 48MB 이하의 문서를 선택하세요.');
  }
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
  const officeResources = app.isPackaged ? path.join(process.resourcesPath,'office') : path.resolve(__dirname,'../.office-build');
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA,'NANAOFFICE') : app.getPath('userData');
  launchOffice = createOfficeLauncher({
    archive:path.join(officeResources,distribution.name),
    cache:path.join(local,'engines'),
    progress:text => { if (!window.isDestroyed()) window.webContents.send('advanced-progress',text); },
  });
  window.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-prevent-unload',event => {
    const response = dialog.showMessageBoxSync(window,{
      type:'question', title:'문서 닫기', message:'저장하지 않은 변경 사항이 있습니다. 프로그램을 닫을까요?',
      buttons:['계속 편집','닫기'], defaultId:0, cancelId:0, noLink:true,
    });
    if (response === 1) event.preventDefault();
  });
  window.once('ready-to-show', () => { if (!hiddenQA) window.show(); });
  ipcMain.on('editor-ready', event => {
    if (event.sender !== window.webContents || rendererReady) return;
    rendererReady = true;
    for (const file of queued.splice(0)) void receive(file);
  });
  function allowed(event) {
    if (event.sender !== window.webContents || event.senderFrame.url !== LINK + '/index.html') throw Error('지원하지 않는 요청입니다.');
  }
  ipcMain.handle('pick-local-file',async (event,type) => {
    allowed(event);
    const options = {
      document:{title:'문서 열기',label:'지원하는 문서',extensions:documentExtensions},
      pdf:{title:'PDF 열기',label:'PDF 문서',extensions:['pdf']},
      image:{title:'이미지 넣기',label:'이미지',extensions:['jpg','jpeg','png']},
    };
    if (typeof type !== 'string' || !Object.hasOwn(options,type)) throw Error('지원하지 않는 요청입니다.');
    const {title,label,extensions} = options[type];
    try {
      const selected = await dialog.showOpenDialog(window,{
        title,buttonLabel:type === 'image' ? '삽입' : '열기',properties:['openFile'],filters:[{name:label,extensions}],
      });
      if (selected.canceled || !selected.filePaths[0]) return null;
      const file = selected.filePaths[0];
      if (!extensions.includes(path.extname(file).slice(1).toLowerCase())) return {error:'지원하는 형식의 파일을 선택하세요.'};
      if (type === 'document' && officeFormat(file)) return await openNative({file});
      const limit = type === 'image' ? 12 * 1024 * 1024 : LIMIT;
      if ((await fs.stat(file)).size > limit) {
        return {error:type === 'image' ? '12MB 이하의 이미지를 선택하세요.' : '48MB 이하의 문서를 선택하세요.'};
      }
      return {name:path.basename(file),bytes:new Uint8Array(await fs.readFile(file))};
    } catch (error) {
      console.error(error);
      return {error:'파일을 읽지 못했습니다. 파일과 접근 권한을 확인하세요.'};
    }
  });
  ipcMain.handle('save-copy', async (event, name, bytes) => {
    allowed(event);
    if (typeof name !== 'string' || name !== path.basename(name) || !supported(name) ||
        !(bytes instanceof Uint8Array) || bytes.byteLength > 56 * 1024 * 1024) throw Error('파일 이름 또는 크기를 확인하세요.');
    const output = await dialog.showSaveDialog(window, {
      title:'다른 이름으로 저장', buttonLabel:'저장', defaultPath:name,
      filters:[{ name:'문서', extensions:[name.split('.').pop()] }],
    });
    if (output.canceled || !output.filePath) return 'cancelled';
    if (path.extname(output.filePath).toLowerCase() !== path.extname(name)) {
      return {status:'error',detail:'원본과 같은 확장자로 저장하세요.'};
    }
    const tmp = output.filePath + '.nana-' + require('node:crypto').randomUUID() + '.tmp';
    try { await fs.writeFile(tmp, bytes, {flag:'wx'}); await fs.rename(tmp, output.filePath); }
    finally { await fs.rm(tmp, {force:true}); }
    return 'saved';
  });
  ipcMain.handle('launch-office', (event,format) => {
    allowed(event);
    return openNative({format});
  });
  ipcMain.handle('open-dropped-office', (event,file) => {
    allowed(event);
    if (typeof file !== 'string' || !path.isAbsolute(file) || !officeFormat(file)) {
      return {error:'파일 열기에서 오피스 문서를 선택하세요.'};
    }
    return openNative({file});
  });
  await window.loadURL(LINK + '/index.html');
  if (hiddenQA) {
    await window.webContents.executeJavaScript("document.querySelector('.brand').textContent.trim()");
    console.log('NANAOFFICE_WINDOW_READY');
    app.quit();
  }
});
app.on('window-all-closed', () => app.quit());
