import { UserError } from './ui-messages.js';
import { getDocument, GlobalWorkerOptions, PDFWorker } from 'pdfjs-dist/legacy/build/pdf.mjs';
import worker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

GlobalWorkerOptions.workerSrc = new URL(worker, location.href).href;
const resources = new URL('./pdf-assets/', location.href).href;

export async function openPdf(bytes) {
  const port = location.protocol === 'nanaoffice:' ?
    new Worker(GlobalWorkerOptions.workerSrc,{type:'module'}) : null;
  const pdfWorker = port ? new PDFWorker({port}) : undefined;
  const task = getDocument({
    data: bytes.slice(),
    cMapUrl: resources + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: resources + 'standard_fonts/',
    wasmUrl: resources + 'wasm/',
    iccUrl: resources + 'iccs/',
    isEvalSupported: false,
    useSystemFonts: true,
    worker: pdfWorker,
  });
  const dispose = async () => {
    try { await task.destroy(); }
    finally { pdfWorker?.destroy(); port?.terminate(); }
  };
  try { return { viewer:await task.promise, rotations:new Map(), notes:[], history:[], dispose }; }
  catch (error) {
    await dispose().catch(() => {});
    throw new UserError(error.name === 'PasswordException' ? '암호가 설정된 PDF는 이 버전에서 열 수 없습니다.' : 'PDF를 읽을 수 없습니다.');
  }
}

function memoImage(text, width) {
  const image = document.createElement('canvas');
  const context = image.getContext('2d');
  const lines = [];
  const font = '24px "Malgun Gothic","Noto Sans KR",sans-serif';
  context.font = font;
  for (const row of text.split('\n')) {
    let line = '';
    for (const char of row) {
      if (line && context.measureText(line + char).width > 2 * width - 28) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
    lines.push(line);
  }
  image.width = Math.max(2, Math.floor(width * 2));
  image.height = lines.length * 31 + 26;
  context.fillStyle = '#fff2ba';
  context.fillRect(0,0,image.width,image.height);
  context.strokeStyle = '#a17824';
  context.lineWidth = 3;
  context.strokeRect(1.5,1.5,image.width - 3,image.height - 3);
  context.fillStyle = '#382d14';
  context.font = font;
  context.textBaseline = 'top';
  lines.forEach((line,index) => context.fillText(line, 14, 13 + index * 31));
  return image;
}

export function renderPdf(parent, model, {el, button, status, changed}) {
  const ribbon = el('div',undefined,'controls pdf-tools');
  const pageNumber = el('span','1 / ' + model.viewer.numPages,'page-count');
  pageNumber.setAttribute('aria-live','polite');
  const previous = button('이전 쪽', () => show(index - 1));
  const next = button('다음 쪽', () => show(index + 1));
  const rotate = button('90° 회전', () => {
    const before = model.rotations.get(index) || 0;
    model.history.push({type:'rotate',index,before});
    model.rotations.set(index,(before + 90) % 360);
    update();
    show(index);
  });
  const undo = button('실행 취소', () => {
    const last = model.history.pop();
    if (!last) return;
    if (last.type === 'note') model.notes.pop();
    else model.rotations.set(last.index,last.before);
    update();
    show(last.index);
  });
  const compose = el('div',undefined,'pdf-compose panel');
  const input = el('textarea');
  input.maxLength = 160;
  input.placeholder = '메모 내용을 입력하세요';
  input.setAttribute('aria-label','PDF 메모 내용');
  const position = button('메모 위치 선택', () => {
    if (!input.value.trim()) { input.focus(); return; }
    placement = input.value.trim();
    stage.classList.add('placing');
    status('PDF에서 메모를 넣을 위치를 누르세요.');
  });
  const cancel = button('닫기', () => {
    placement = '';
    stage.classList.remove('placing');
    compose.hidden = true;
    noteToggle.setAttribute('aria-expanded','false');
    status('');
  });
  compose.id = 'pdf-compose';
  compose.hidden = true;
  compose.append(input, position, cancel);
  const noteToggle = button('메모 추가', () => {
    const open = compose.hidden;
    compose.hidden = !open;
    noteToggle.setAttribute('aria-expanded', String(open));
    placement = '';
    stage.classList.remove('placing');
    if (open) input.focus();
    else status('');
  });
  noteToggle.setAttribute('aria-expanded','false');
  noteToggle.setAttribute('aria-controls', compose.id);
  const stage = el('div',undefined,'pdf-stage');
  const canvas = el('canvas');
  canvas.setAttribute('aria-label','PDF 페이지');
  canvas.tabIndex = 0;
  const overlay = el('canvas',undefined,'pdf-memos');
  overlay.setAttribute('aria-hidden','true');
  stage.append(canvas,overlay);
  ribbon.append(previous,pageNumber,next,rotate,noteToggle,undo);
  parent.append(ribbon,compose,stage);
  let index = 0, generation = 0, lastWidth = 0;
  let viewport, raster, placement = '';
  let task;
  const observer = new ResizeObserver(() => {
    if (Math.abs(stage.clientWidth - lastWidth) >= 2 && stage.clientWidth > 0) show(index);
  });
  observer.observe(stage);
  const context = canvas.getContext('2d');

  function update() {
    undo.disabled = model.history.length === 0;
    changed(model.history.length > 0);
  }
  async function show(pageIndex) {
    if (!stage.isConnected || pageIndex < 0 || pageIndex >= model.viewer.numPages) return;
    index = pageIndex;
    const draw = ++generation;
    lastWidth = stage.clientWidth;
    viewport = undefined;
    pageNumber.textContent = (index + 1) + ' / ' + model.viewer.numPages;
    previous.disabled = index === 0;
    next.disabled = index + 1 === model.viewer.numPages;
    task?.cancel();
    try {
      const page = await model.viewer.getPage(index + 1);
      if (draw !== generation) return;
      const rotation = (page.rotate + (model.rotations.get(index) || 0)) % 360;
      const native = page.getViewport({scale:1,rotation});
      const scale = Math.min(2, Math.max(0.05,lastWidth/native.width), 2200/Math.max(native.width,native.height));
      const view = page.getViewport({scale,rotation});
      const pixelRatio = Math.min(devicePixelRatio || 1,2);
      const image = el('canvas');
      image.width = Math.max(1,Math.round(view.width * pixelRatio));
      image.height = Math.max(1,Math.round(view.height * pixelRatio));
      task = page.render({canvas:image,canvasContext:image.getContext('2d'),viewport:view,
        transform:[pixelRatio,0,0,pixelRatio,0,0]});
      await task.promise;
      if (draw !== generation) return;
      canvas.width = overlay.width = image.width;
      canvas.height = overlay.height = image.height;
      context.drawImage(image,0,0);
      viewport = view;
      raster = pixelRatio;
      paintNotes();
    } catch (error) {
      if (draw === generation && error.name !== 'RenderingCancelledException') status('이 PDF 페이지를 표시할 수 없습니다.',true);
    }
  }

  function paintNotes() {
    const ink = overlay.getContext('2d');
    ink.clearRect(0,0,overlay.width,overlay.height);
    for (const note of model.notes.filter(item => item.index === index)) {
      const [x,y] = viewport.convertToViewportPoint(note.x,note.y);
      ink.save();
      ink.scale(raster,raster);
      ink.translate(x,y);
      ink.rotate((viewport.rotation - note.rotation) * Math.PI / 180);
      ink.drawImage(note.image,0,-note.height * viewport.scale,note.width * viewport.scale,note.height * viewport.scale);
      ink.restore();
    }
  }

  function place(x, y) {
    if (!placement || !viewport) return;
    const width = Math.min(216, viewport.width / viewport.scale * 0.86);
    const image = memoImage(placement,width);
    const height = image.height / 2;
    if (height * viewport.scale > viewport.height) { status('이 페이지에 넣을 수 있도록 메모를 줄여 주세요.',true); return; }
    const left = Math.max(0,Math.min(x,viewport.width-width*viewport.scale));
    const top = Math.max(0,Math.min(y,viewport.height-height*viewport.scale));
    const point = viewport.convertToPdfPoint(left,top+height*viewport.scale);
    model.notes.push({index, x:point[0], y:point[1], width, height, rotation:viewport.rotation, image});
    model.history.push({type:'note',index});
    input.value = '';
    cancel.click();
    paintNotes();
    update();
    status('PDF에 메모를 추가했습니다.');
  }
  canvas.addEventListener('click', event => {
    if (!viewport) return;
    const rectangle = canvas.getBoundingClientRect();
    place((event.clientX-rectangle.left)*viewport.width/rectangle.width,
      (event.clientY-rectangle.top)*viewport.height/rectangle.height);
  });
  canvas.addEventListener('keydown', event => {
    if (event.key === 'Enter' && viewport && placement) place(viewport.width * 0.2,viewport.height * 0.2);
  });
  update();
  show(0);
  return () => { generation++; task?.cancel(); observer.disconnect(); };
}

export async function savePdf(model, original) {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const pdf = await PDFDocument.load(original);
  for (const [index, rotation] of model.rotations) {
    const page = pdf.getPage(index);
    page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
  }
  for (const note of model.notes) {
    const image = await pdf.embedPng(note.image.toDataURL('image/png'));
    pdf.getPage(note.index).drawImage(image, {
      x:note.x,y:note.y,width:note.width,height:note.height,rotate:degrees(note.rotation),
    });
  }
  return pdf.save();
}
