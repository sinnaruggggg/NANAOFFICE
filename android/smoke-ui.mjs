import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const packageName = 'com.sinnaruggggg.nanaoffice';
const timeout = ms => new Promise(resolve => setTimeout(resolve,ms));
let pid;
for (let attempt=0; attempt<12 && !pid; attempt++) {
  try { pid = execFileSync('adb',['shell','pidof',packageName],{encoding:'utf8'}).trim().split(/\s+/)[0]; }
  catch { await timeout(750); }
}
if (!/^\d+$/.test(pid)) throw Error('Android editor process did not start');
execFileSync('adb',['forward','tcp:9222','localabstract:webview_devtools_remote_'+pid]);
let channel;
try {
  for (let attempt=0; attempt<20; attempt++) {
    try {
      const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
      const page = targets.find(item => item.url?.includes('offline.nanaoffice.local'));
      if (page?.webSocketDebuggerUrl) {
        channel = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve,reject) => {
          channel.addEventListener('open',resolve,{once:true});
          channel.addEventListener('error',reject,{once:true});
        });
        break;
      }
    } catch {}
    await timeout(500);
  }
  if (!channel) throw Error('Unable to connect to Android WebView for UI checks');
  let sequence = 0;
  const pending = new Map();
  channel.addEventListener('message',event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const reply = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reply.reject(Error(message.error.message));
    else reply.resolve(message.result);
  });
  const send = (method,params) => new Promise((resolve,reject) => {
    const id = ++sequence;
    pending.set(id,{resolve,reject});
    channel.send(JSON.stringify({id,method,params}));
    setTimeout(() => {
      if (pending.delete(id)) reject(Error('WebView command timed out: '+method));
    },10000).unref();
  });
  async function js(expression) {
    const result = await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function expect(expression) {
    for (let attempt=0; attempt<35; attempt++) {
      if (await js(expression)) return;
      await timeout(300);
    }
    throw Error('WebView state did not update: ' + expression + '; ' + await js('document.body.innerText'));
  }
  async function center(selector) {
    const location = await js('(() => { const b=document.querySelector(' + JSON.stringify(selector) +
      '); if(!b)return null; b.scrollIntoView({block:"nearest"}); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
    if (!location) throw Error('Missing control '+selector);
    return location;
  }
  async function tap(selector) {
    const location = await center(selector);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[location]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  async function drag(selector,dx,dy) {
    const {x,y} = await center(selector);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy}]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  function screenshot(name) {
    const screenshot=execFileSync('adb',['exec-out','screencap','-p'],{maxBuffer:8*1024*1024});
    return writeFile(name,screenshot);
  }

  await expect("!document.querySelector('#home').hidden && document.querySelector('#open-pdf').innerText.includes('PDF')");
  await timeout(450);
  await screenshot('nana-mobile-home.png');
  await tap('[data-new="pptx"]');
  await expect("document.querySelector('.slide-artwork')?.naturalWidth > 100 && document.querySelectorAll('.slide-object').length > 0");
  await expect("document.querySelector('.slide-editor.thumbs-collapsed') !== null");
  await tap('.slide-object');
  await expect("document.querySelector('.slide-object[aria-pressed=true]') !== null");
  await tap('.slide-object[aria-pressed=true]');
  await expect("!document.querySelector('.slide-inline-text').hidden && document.activeElement.matches('.slide-inline-text textarea')");
  await send('Input.insertText',{text:' 편집'});
  await expect("document.querySelector('.slide-inline-text textarea').value.includes('편집')");
  await js("document.querySelector('.slide-inline-text textarea').value = '모바일 슬라이드 편집'");
  await tap('.slide-text-actions:last-child button');
  await expect("document.querySelector('.slide-text-panel')?.hidden && [...document.querySelectorAll('.slide-object')].some(b=>b.getAttribute('aria-label')==='모바일 슬라이드 편집')");
  await js("window.beforeDrag = document.querySelector('.slide-object[aria-pressed=true]').style.left");
  await drag('.slide-object[aria-pressed=true]',-16,-17);
  await expect("document.querySelector('.slide-object[aria-pressed=true]').style.left !== window.beforeDrag");
  await js("window.beforeResize = document.querySelector('.slide-object[aria-pressed=true]').style.width");
  await drag('.slide-resize-handle',-21,12);
  await expect("document.querySelector('.slide-object[aria-pressed=true]').style.width !== window.beforeResize");
  const {x,y} = await center('.slide-stage');
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-24,y:y+28,id:1},{x:x+24,y:y+28,id:2}]});
  await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-59,y:y+28,id:1},{x:x+59,y:y+28,id:2}]});
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect("document.querySelector('.slide-viewport').scrollWidth > document.querySelector('.slide-viewport').clientWidth");
  await tap('[aria-label="슬라이드 화면 맞춤"]');
  await expect("document.documentElement.scrollWidth === innerWidth");
  await screenshot('nana-mobile-editor.png');
  await send('Emulation.setDeviceMetricsOverride',{
    width:1024,height:700,deviceScaleFactor:1,mobile:true,screenWidth:1024,screenHeight:700,
  });
  await expect('innerWidth > 850');
  await tap('.slide-ribbon-actions button:last-child');
  await expect("document.querySelector('.slide-editor.pc-mode:not(.thumbs-collapsed)') !== null");
  await js("window.beforeKey = document.querySelector('.slide-object[aria-pressed=true]').style.left; document.querySelector('.slide-viewport').focus()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await expect("document.querySelector('.slide-object[aria-pressed=true]').style.left !== window.beforeKey");
  const pc = await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('nana-mobile-pc-mode.png',Buffer.from(pc.data,'base64'));
  await tap('.slide-ribbon-actions button:last-child');
  await expect("document.querySelector('.slide-editor:not(.pc-mode).thumbs-collapsed') !== null");
  await send('Emulation.clearDeviceMetricsOverride',{});
  await expect('innerWidth < 400');
  await tap('#pptx-tab-slide');
  await tap('#pptx-panel-slide button:nth-of-type(3)');
  await expect("document.querySelector('.slide-count').textContent === '2 / 2'");
  await tap('#pptx-tab-home');
  await js('window.heightBeforeShow = innerHeight');
  await tap('.slide-play');
  await expect("document.querySelector('.slide-show[open] .slide-show-count')?.textContent === '2 / 2'");
  await expect("innerHeight > window.heightBeforeShow && document.querySelector('.slide-show-image').naturalWidth > 100");
  await expect("document.querySelector('.slide-show-controls button:nth-of-type(2)').disabled");
  await drag('.slide-show-screen',75,0);
  await expect("document.querySelector('.slide-show-count').textContent === '1 / 2'");
  await screenshot('nana-mobile-slide-show.png');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await expect("document.querySelector('.slide-show-count').textContent === '2 / 2'");
  execFileSync('adb',['shell','input','keyevent','4']);
  await expect("!document.querySelector('.slide-show').open && !document.querySelector('#workspace').hidden && innerHeight === window.heightBeforeShow");
  await tap('#pptx-tab-slide');
  await tap('#pptx-panel-slide button:first-child');
  await expect("document.querySelector('.slide-show[open] .slide-show-count')?.textContent === '1 / 2'");
  await tap('.slide-show-controls button:last-child');
  await expect("!document.querySelector('.slide-show').open && document.querySelector('.slide-count').textContent === '2 / 2'");
  console.log('Android touch and tablet editing, full-screen show, navigation and Android Back verified');
} finally {
  channel?.close();
  execFileSync('adb',['forward','--remove','tcp:9222']);
}
