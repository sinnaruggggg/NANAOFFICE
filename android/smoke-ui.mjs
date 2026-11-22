import { execFileSync } from 'node:child_process';

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
  async function tap(selector) {
    const location = await js('(() => { const b=document.querySelector(' + JSON.stringify(selector) +
      '); if(!b)return null; b.scrollIntoView({block:"nearest"}); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
    if (!location) throw Error('Missing control '+selector);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[location]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  function screenshot(name) {
    const screenshot=execFileSync('adb',['exec-out','screencap','-p'],{maxBuffer:8*1024*1024});
    return import('node:fs/promises').then(fs=>fs.writeFile(name,screenshot));
  }

  await expect("!document.querySelector('#home').hidden && document.querySelector('#open-pdf').innerText.includes('PDF')");
  await screenshot('nana-mobile-home.png');
  await tap('[data-new="pptx"]');
  await expect("document.querySelector('.slide-artwork')?.naturalWidth > 100 && document.querySelectorAll('.slide-object').length > 0");
  await tap('.slide-object');
  await expect("document.querySelector('.slide-object[aria-pressed=true]') !== null");
  await tap('[data-action="edit-text"]');
  await expect("document.querySelector('.slide-text-panel')?.hidden === false");
  await js("document.querySelector('.slide-text-panel textarea').value = '모바일 슬라이드 편집'; document.querySelector('.slide-text-panel .slide-text-actions:last-child button').click()");
  await expect("document.querySelector('.slide-text-panel')?.hidden && [...document.querySelectorAll('.slide-object')].some(b=>b.getAttribute('aria-label')==='모바일 슬라이드 편집')");
  await expect("document.documentElement.scrollWidth === innerWidth");
  await screenshot('nana-mobile-editor.png');
  console.log('Android WebView home, PPT canvas, touch selection, text update and viewport verified');
} finally {
  channel?.close();
  execFileSync('adb',['forward','--remove','tcp:9222']);
}
