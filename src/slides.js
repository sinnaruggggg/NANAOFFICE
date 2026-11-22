import {
  addSlide, addSlideImage, addSlideShape, addSlideTextBox, duplicateSlideAt, emu,
  getGroupChildren, getGroupTransform, getShapeBoundsResolved, getShapeId, getShapeKind, getShapeName,
  getShapeRotation, getShapeText, getSlideLayouts, getSlideLayoutType, getSlideShapes, getSlideSize,
  getSlides, getSlideTitle, hasShapeText, isShapeLocked, loadPresentation, moveSlide, removeShape,
  removeSlide, savePresentation, setShapeBounds, setShapeFill, setShapeText, setShapeTextFormat,
} from '@office-kit/pptx';
import { renderSlideToSvg } from '@office-kit/pptx-preview';
import './slides.css';

const MiB = 1024 * 1024;
const limits = {maxEntries:12000,maxTotalUncompressedBytes:192*MiB,maxXmlPartBytes:16*MiB,maxTotalXmlBytes:64*MiB};
const presentationOptions = { limits };

export async function openSlides(bytes) {
  const presentation = await loadPresentation(bytes, presentationOptions);
  if (!getSlides(presentation).length) throw Error('편집할 슬라이드가 없습니다.');
  return { presentation, undo:[], undoBytes:0 };
}
export function saveSlides(model) { return savePresentation(model.presentation); }

function objects(presentation, slide) {
  const targets = [];
  const project = (shape, x0 = 0, y0 = 0, sx = 1, sy = 1, depth = 0) => {
    const kind = getShapeKind(shape);
    const group = kind === 'group' ? getGroupTransform(shape) : null;
    if (group?.inner?.w && group.inner.h && depth < 12 && getShapeRotation(shape) === 0) {
      const gx = group.outer.w / group.inner.w;
      const gy = group.outer.h / group.inner.h;
      getGroupChildren(shape).forEach(child => project(child,
        x0 + sx*(group.outer.x - group.inner.x*gx), y0 + sy*(group.outer.y - group.inner.y*gy),
        sx*gx, sy*gy, depth + 1));
      return;
    }
    const local = group?.outer || getShapeBoundsResolved(presentation,shape);
    if (!local || local.w < 0 || local.h < 0) return;
    targets.push({
      shape,id:getShapeId(shape),kind,
      bounds:{x:x0+local.x*sx,y:y0+local.y*sy,w:local.w*sx,h:local.h*sy},
      text:(kind === 'shape' || kind === 'connector') && (hasShapeText(shape) || kind === 'shape'),
      movable:depth === 0 && !isShapeLocked(shape) && kind !== 'group',
    });
  };
  getSlideShapes(slide).forEach(shape => project(shape));
  return targets;
}

export function renderSlides(parent, model, {el,button,status,changed}) {
  const wrap = el('section',undefined,'slide-editor');
  const stageBox = el('div',undefined,'slide-stage-box');
  const viewport = el('div',undefined,'slide-viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('aria-label','슬라이드 캔버스');
  const stage = el('div',undefined,'slide-stage');
  const artwork = el('img',undefined,'slide-artwork');
  const overlay = el('div',undefined,'slide-shapes');
  const thumbs = el('div',undefined,'slide-thumbs');
  const canvasControls = el('div',undefined,'slide-nav');
  const ribbon = el('section',undefined,'slide-ribbon');
  const ribbonTop = el('div',undefined,'slide-ribbon-top');
  const tabs = el('div',undefined,'slide-tabs');
  const homeTools = el('div',undefined,'slide-tools');
  const insertTools = el('div',undefined,'slide-tools');
  const slideTools = el('div',undefined,'slide-tools');
  const editPane = el('div',undefined,'panel slide-text-panel');
  const inlineText = el('div',undefined,'slide-inline-text');
  const editInput = el('textarea');
  editInput.setAttribute('aria-label','선택한 개체의 텍스트');
  editInput.rows = 3;
  editPane.hidden = true;
  inlineText.append(editInput);
  inlineText.hidden = true;
  thumbs.setAttribute('aria-label','슬라이드 썸네일');
  thumbs.id = 'pptx-slide-list';
  tabs.setAttribute('role','tablist');
  tabs.setAttribute('aria-label','프레젠테이션 편집 메뉴');
  artwork.alt = '현재 슬라이드';
  artwork.draggable = false;
  stage.append(artwork,overlay,inlineText);
  viewport.append(stage);
  stageBox.append(canvasControls,viewport,editPane);
  wrap.append(ribbon,thumbs,stageBox);
  parent.append(wrap);

  let index = 0;
  let selectedId;
  let selectedTarget;
  let dragMode = '';
  let pending = false;
  let editShape;
  let originalText = '';
  let previewUrl;
  let paintGeneration = 0;
  let thumbObserver;
  let zoom = 1;
  let gesture;
  let draggingObject = false;
  const desktop = Boolean(window.nanaDesktop);
  let pcMode = desktop || localStorage.getItem('nana-ppt-mode') === 'pc';
  const thumbUrls = new Map();
  const size = getSlideSize(model.presentation) || {width:12192000,height:6858000};
  stage.style.aspectRatio = size.width + ' / ' + size.height;
  const slideList = () => getSlides(model.presentation);
  const currentSlide = () => slideList()[index];
  const slideNumber = el('span',undefined,'slide-count');
  slideNumber.setAttribute('aria-live','polite');

  const previous = button('이전',() => go(index-1));
  const next = button('다음',() => go(index+1));
  previous.setAttribute('aria-label','이전 슬라이드');
  next.setAttribute('aria-label','다음 슬라이드');
  const zoomOut = button('−',() => setZoom(zoom/1.25));
  const fitZoom = button('맞춤',() => setZoom(1));
  const expand = button('+',() => setZoom(zoom*1.25));
  zoomOut.setAttribute('aria-label','슬라이드 축소');
  expand.setAttribute('aria-label','슬라이드 확대');
  fitZoom.setAttribute('aria-label','슬라이드 화면 맞춤');
  const pageControls = el('div',undefined,'slide-page-controls');
  const zoomControls = el('div',undefined,'slide-zoom-controls');
  pageControls.append(previous,slideNumber,next);
  zoomControls.append(zoomOut,fitZoom,expand);
  canvasControls.append(pageControls,zoomControls);
  function setZoom(value, x, y, anchor) {
    const rect = viewport.getBoundingClientRect();
    x ??= rect.width/2;
    y ??= rect.height/2;
    anchor ??= zoomAnchor(x,y);
    zoom = Math.max(1,Math.min(4,value));
    stage.style.width = zoom*100 + '%';
    stage.style.maxWidth = 66*size.width/size.height*zoom + 'dvh';
    fitZoom.textContent = zoom === 1 ? '맞춤' : Math.round(zoom*100)+'%';
    zoomOut.disabled = zoom === 1;
    expand.disabled = zoom === 4;
    viewport.scrollLeft = stage.offsetLeft+anchor.x*zoom-x;
    viewport.scrollTop = anchor.y*zoom-y;
  }
  function zoomAnchor(x,y) {
    return {x:(viewport.scrollLeft+x-stage.offsetLeft)/zoom,y:(viewport.scrollTop+y)/zoom};
  }
  viewport.addEventListener('wheel',event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    setZoom(zoom*(event.deltaY < 0 ? 1.15 : 1/1.15),event.clientX-rect.left,event.clientY-rect.top);
  },{passive:false});
  function touchPair(touches) {
    const [a,b] = touches;
    const rect = viewport.getBoundingClientRect();
    return {x:(a.clientX+b.clientX)/2-rect.left,y:(a.clientY+b.clientY)/2-rect.top,
      span:Math.max(1,Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY))};
  }
  viewport.addEventListener('touchstart',event => {
    if (event.target.closest('textarea')) return;
    if (event.touches.length === 2) {
      const {x,y,span} = touchPair(event.touches);
      gesture = {span,zoom,anchor:zoomAnchor(x,y)};
    } else if (event.touches.length === 1 && zoom > 1 &&
        !event.target.closest('.slide-object[aria-pressed=true],.slide-resize-handle')) {
      const {clientX,clientY} = event.touches[0];
      gesture = {clientX,clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
    }
  },{passive:true});
  viewport.addEventListener('touchmove',event => {
    if (!gesture) return;
    event.preventDefault();
    if (gesture.span && event.touches.length === 2) {
      const {x,y,span} = touchPair(event.touches);
      setZoom(gesture.zoom*span/gesture.span,x,y,gesture.anchor);
    } else if (!gesture.span && event.touches.length === 1) {
      const {clientX,clientY} = event.touches[0];
      viewport.scrollLeft = gesture.left+gesture.clientX-clientX;
      viewport.scrollTop = gesture.top+gesture.clientY-clientY;
    }
  },{passive:false});
  const endGesture = event => {
    if (!event.touches.length) requestAnimationFrame(() => {
      if (!draggingObject) gesture = undefined;
    });
  };
  viewport.addEventListener('touchend',endGesture);
  viewport.addEventListener('touchcancel',endGesture);

  const changeText = button('텍스트 편집', showText);
  changeText.dataset.action = 'edit-text';
  const sidebar = button('목록 접기',() => setSidebar(!wrap.classList.contains('thumbs-collapsed')));
  function setSidebar(collapsed) {
    wrap.classList.toggle('thumbs-collapsed',collapsed);
    sidebar.textContent = collapsed ? '목록 펼치기' : '목록 접기';
    sidebar.setAttribute('aria-expanded',String(!collapsed));
  }
  const mode = button('PC 모드',() => {
    pcMode = !pcMode;
    localStorage.setItem('nana-ppt-mode',pcMode ? 'pc' : 'touch');
    updateMode();
  });
  mode.hidden = desktop;
  function updateMode() {
    wrap.classList.toggle('pc-mode',pcMode);
    mode.textContent = pcMode ? '터치 모드' : 'PC 모드';
    setSidebar(!pcMode);
  }
  sidebar.setAttribute('aria-expanded','true');
  sidebar.setAttribute('aria-controls',thumbs.id);
  const setDragMode = mode => {
    dragMode = dragMode === mode ? '' : mode;
    updateTools();
    status(dragMode === 'move' ? '선택한 개체를 끌어서 옮기세요.' :
      dragMode === 'resize' ? '선택한 개체를 끌어서 크기를 조절하세요.' : '');
  };
  const dragging = button('이동',() => setDragMode('move'));
  const resize = button('크기 조절',() => setDragMode('resize'));
  dragging.dataset.transform = 'move';
  resize.dataset.transform = 'resize';
  const remove = button('개체 삭제',() => {
    if (!selectedTarget || isShapeLocked(selectedTarget.shape) || !confirm('선택한 개체를 삭제할까요?')) return;
    void change(() => { removeShape(selectedTarget.shape); selectedId = undefined; });
  });
  const addText = button('텍스트 상자',async () => {
    if (await change(() => {
      const shape = addSlideTextBox(currentSlide(),{...insertPosition(),text:'텍스트 입력',name:'텍스트 상자'});
      setShapeTextFormat(shape,{ size:22 });
      selectedId = getShapeId(shape);
    })) showText();
  });
  const addBox = button('사각형',() => change(() => {
    const shape = addSlideShape(currentSlide(),{...insertPosition(),preset:'roundRect',name:'사각형'});
    setShapeFill(shape,'#3B8B72');
    selectedId = getShapeId(shape);
  }));
  const photo = el('input');
  photo.type = 'file';
  photo.accept = '.jpg,.jpeg,.png';
  photo.hidden = true;
  photo.addEventListener('change',async () => {
    const file = photo.files[0];
    photo.value = '';
    if (!file) return;
    const format = /\.png$/i.test(file.name) ? 'png' : /\.jpe?g$/i.test(file.name) ? 'jpeg' : '';
    if (!format || file.size > 12*MiB) { status('12MB 이하의 PNG 또는 JPG를 선택하세요.',true); return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await change(() => {
        const shape = addSlideImage(currentSlide(),bytes,{...insertPosition(),h:emu(size.height*0.45),
          format,fit:'contain',name:file.name});
        selectedId = getShapeId(shape);
      });
    } catch (error) { status(error.message,true); }
  });
  const addImage = button('이미지',() => photo.click());
  const undo = button('실행 취소',undoEdit);
  homeTools.append(changeText,dragging,resize,remove,undo);
  insertTools.append(addText,addBox,addImage,photo);

  const add = button('새 슬라이드',() => change(() => {
    const layouts = getSlideLayouts(model.presentation);
    const layout = layouts.find(item => getSlideLayoutType(item) === 'blank') || layouts[0];
    if (!layout) throw Error('사용할 슬라이드 레이아웃이 없습니다.');
    const slide = addSlide(model.presentation,{layout});
    if (getSlideLayoutType(layout) !== 'blank') getSlideShapes(slide).slice().forEach(removeShape);
    moveSlide(model.presentation,slide,index+1);
    index++;
    selectedId = undefined;
  }));
  const duplicate = button('복제',() => change(() => {
    duplicateSlideAt(model.presentation,index+1,currentSlide());
    index++;
    selectedId = undefined;
  }));
  const moveUp = button('앞으로',() => change(() => { moveSlide(model.presentation,currentSlide(),index-1); index--; }));
  const moveDown = button('뒤로',() => change(() => { moveSlide(model.presentation,currentSlide(),index+1); index++; }));
  const deleteSlide = button('슬라이드 삭제',() => {
    if (!confirm('이 슬라이드를 삭제할까요?')) return;
    void change(() => {
      removeSlide(model.presentation,currentSlide());
      index = Math.min(index,slideList().length-1);
      selectedId = undefined;
    });
  });
  slideTools.append(add,duplicate,moveUp,moveDown,deleteSlide);
  const menu = [
    {key:'home',name:'홈',panel:homeTools},
    {key:'insert',name:'삽입',panel:insertTools},
    {key:'slide',name:'슬라이드',panel:slideTools},
  ];
  function selectTab(key, focus = false) {
    menu.forEach(item => {
      const on = item.key === key;
      item.panel.hidden = !on;
      item.button.tabIndex = on ? 0 : -1;
      item.button.setAttribute('aria-selected',String(on));
      if (on && focus) item.button.focus();
    });
  }
  for (const item of menu) {
    item.button = button(item.name,() => selectTab(item.key));
    item.button.id = 'pptx-tab-' + item.key;
    item.button.setAttribute('role','tab');
    item.button.setAttribute('aria-controls','pptx-panel-' + item.key);
    item.panel.id = 'pptx-panel-' + item.key;
    item.panel.setAttribute('role','tabpanel');
    item.panel.setAttribute('aria-labelledby',item.button.id);
    tabs.append(item.button);
  }
  tabs.addEventListener('keydown',event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const current = menu.findIndex(item => item.button === event.target);
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? menu.length - 1 :
      (current + direction + menu.length) % menu.length;
    selectTab(menu[next].key,true);
  });
  const ribbonActions = el('div',undefined,'slide-ribbon-actions');
  ribbonActions.append(sidebar,mode);
  ribbonTop.append(tabs,ribbonActions);
  ribbon.append(ribbonTop,homeTools,insertTools,slideTools);
  selectTab('home');
  updateMode();
  setZoom(1);

  const editActions = el('div',undefined,'slide-text-actions');
  const apply = button('적용',() => flush().catch(error => status(error.message,true)));
  const cancel = button('취소',hideText);
  const textTools = el('div',undefined,'slide-text-actions');
  const bold = el('select');
  bold.setAttribute('aria-label','글자 굵기');
  for (const [value,label] of [['','굵기 유지'],['bold','굵게'],['normal','보통']]) {
    const option = el('option',label);
    option.value = value;
    bold.append(option);
  }
  const pointSize = el('input');
  pointSize.type = 'number'; pointSize.min = 8; pointSize.max = 96;
  pointSize.placeholder = '크기';
  pointSize.setAttribute('aria-label','글자 크기(pt)');
  const ptLabel = el('label','글자 크기');
  ptLabel.append(pointSize);
  textTools.append(bold,ptLabel);
  editActions.append(apply,cancel); editPane.append(textTools,editActions);

  function insertPosition() {
    return {x:emu(size.width*0.28),y:emu(size.height*0.35),w:emu(size.width*0.44),h:emu(size.height*0.22)};
  }
  function hasDraft() {
    return Boolean(editShape && (editInput.value !== originalText || bold.value || pointSize.value));
  }
  function showText() {
    if (!selectedTarget?.text || pending) return;
    if (editShape === selectedTarget.shape && !editPane.hidden) { editInput.focus(); return; }
    editShape = selectedTarget.shape;
    selectTab('home');
    originalText = getShapeText(editShape);
    editInput.value = originalText;
    bold.value = ''; pointSize.value = '';
    editPane.hidden = false;
    inlineText.hidden = false;
    place(inlineText,selectedTarget.bounds,getShapeRotation(editShape));
    wrap.classList.add('editing-slide-text');
    editInput.focus({preventScroll:true});
    inlineText.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  function hideText() {
    editShape = undefined;
    editPane.hidden = true;
    inlineText.hidden = true;
    wrap.classList.remove('editing-slide-text');
    editInput.value = '';
    bold.value = ''; pointSize.value = '';
  }
  async function flush() {
    const shape = editShape;
    if (!shape) return;
    if (!hasDraft()) { hideText(); return; }
    const text = editInput.value;
    const sizePt = pointSize.value ? Number(pointSize.value) : null;
    if (sizePt !== null && (!Number.isFinite(sizePt) || sizePt < 8 || sizePt > 96)) {
      throw Error('글자 크기는 8~96pt로 입력하세요.');
    }
    const weight = bold.value;
    const updated = await change(() => {
      if (text !== originalText) setShapeText(shape,text,{preserveFormatting:true});
      if (weight || sizePt !== null) setShapeTextFormat(shape,{
        ...(weight ? {bold:weight === 'bold'} : {}), ...(sizePt !== null ? {size:sizePt} : {}),
      });
    },true);
    if (!updated) throw Error('텍스트 변경을 적용할 수 없습니다.');
    hideText();
  }

  async function change(action, editing = false) {
    if (pending) return false;
    try { if (!editing && editShape) await flush(); }
    catch (error) { status(error.message,true); return false; }
    if (pending) return false;
    pending = true;
    wrap.inert = true;
    let checkpoint;
    try {
      checkpoint = {bytes:await saveSlides(model),index,selectedId};
      action();
      model.undo.push(checkpoint);
      model.undoBytes += checkpoint.bytes.length;
      while (model.undo.length > 1 && (model.undo.length > 8 || model.undoBytes > 32*MiB)) {
        model.undoBytes -= model.undo.shift().bytes.length;
      }
      changed();
      repaint(true);
      status('');
      return true;
    } catch (error) {
      if (checkpoint) {
        try {
          model.presentation = await loadPresentation(checkpoint.bytes,presentationOptions);
          index = checkpoint.index; selectedId = checkpoint.selectedId;
          hideText();
          repaint(true);
        } catch {}
      }
      status('편집을 적용하지 못했습니다. ' + (error.message || ''),true);
      return false;
    } finally { pending = false; wrap.inert = false; updateTools(); }
  }

  async function undoEdit() {
    if (pending || !model.undo.length) return;
    hideText();
    pending = true; wrap.inert = true;
    const checkpoint = model.undo.at(-1);
    try {
      model.presentation = await loadPresentation(checkpoint.bytes,presentationOptions);
      model.undo.pop();
      model.undoBytes -= checkpoint.bytes.length;
      index = checkpoint.index; selectedId = checkpoint.selectedId;
      changed(); repaint(true); status('');
    } catch (error) { status('실행 취소에 실패했습니다. ' + error.message,true); }
    finally { pending = false; wrap.inert = false; updateTools(); }
  }

  async function go(value) {
    if (pending || value < 0 || value >= slideList().length || value === index) return;
    try {
      await flush();
      index = value; selectedId = undefined; dragMode = ''; status('');
      repaint(false);
    } catch (error) { status(error.message,true); }
  }

  function bitmap(slide) {
    const svg = renderSlideToSvg(model.presentation,slide,{textLayout:'svg',
      eastAsianFamily:'sans-serif',resolveFamily:family => family || 'sans-serif'});
    return URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  }
  function releaseThumbs() {
    thumbObserver?.disconnect();
    for (const url of thumbUrls.values()) URL.revokeObjectURL(url);
    thumbUrls.clear();
  }
  function buildThumbs() {
    releaseThumbs();
    thumbs.replaceChildren();
    thumbObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        thumbObserver.unobserve(entry.target);
        const slide = slideList()[Number(entry.target.dataset.index)];
        if (!slide) return;
        try {
          const uri = bitmap(slide);
          thumbUrls.set(entry.target,uri);
          entry.target.querySelector('img').src = uri;
        } catch {}
      });
    },{root:thumbs,rootMargin:'120px'});
    slideList().forEach((slide,i) => {
      const title = getSlideTitle(slide) || '슬라이드 ' + (i+1);
      const item = button('',() => go(i));
      item.className = 'slide-thumb'; item.dataset.index = i;
      item.setAttribute('aria-label',(i+1) + '번 ' + title);
      item.title = title;
      const image = el('img'); image.alt = '';
      image.style.aspectRatio = size.width+'/'+size.height;
      item.append(image,el('span',String(i+1)));
      thumbs.append(item);
      thumbObserver.observe(item);
    });
  }

  function place(frame, bounds, rotation) {
    frame.style.left = (100*bounds.x/size.width)+'%';
    frame.style.top = (100*bounds.y/size.height)+'%';
    frame.style.width = (100*bounds.w/size.width)+'%';
    frame.style.height = (100*bounds.h/size.height)+'%';
    frame.style.rotate = rotation+'deg';
  }
  function handles(targets) {
    overlay.replaceChildren();
    for (const target of targets) {
      const selected = target.id === selectedId;
      const frame = button('',async () => {
        if (dragMode || pending) return;
        try {
          await flush();
          if (selectedId === target.id && target.text) { showText(); return; }
          selectedId = target.id;
          const next = objects(model.presentation,currentSlide());
          selectedTarget = next.find(item => item.id === selectedId);
          handles(next);
          updateTools();
        } catch (error) { status(error.message,true); }
      });
      const name = getShapeName(target.shape) || '개체 ' + target.id;
      const text = target.text ? getShapeText(target.shape).replace(/\s+/g,' ').trim().slice(0,65) : '';
      frame.className = 'slide-object';
      frame.dataset.shape = target.id;
      frame.setAttribute('aria-label', text || name);
      frame.setAttribute('aria-pressed',String(selected));
      frame.title = name;
      place(frame,target.bounds,getShapeRotation(target.shape));
      overlay.append(frame);
      if (selected && target.movable) {
        const handles = el('div',undefined,'slide-selection-handles');
        const grip = el('span',undefined,'slide-resize-handle');
        grip.setAttribute('aria-hidden','true');
        handles.append(grip);
        place(handles,target.bounds,getShapeRotation(target.shape));
        overlay.append(handles);
        attachDrag(frame,frame,handles,target);
        attachDrag(grip,frame,handles,target,'resize');
      }
    }
    updateTools();
  }
  function attachDrag(control,frame,handles,target,forcedMode) {
    control.addEventListener('pointerdown',start => {
      if (pending || editShape || start.button !== 0 || !start.isPrimary) return;
      control.setPointerCapture(start.pointerId);
      const rect = stage.getBoundingClientRect();
      const origin = target.bounds;
      const mode = forcedMode || dragMode || 'move';
      const rotation = getShapeRotation(target.shape);
      let current;
      const onMove = event => {
        if (event.pointerId !== start.pointerId || gesture?.span) return;
        const px = event.clientX-start.clientX;
        const py = event.clientY-start.clientY;
        if (!current && Math.hypot(px,py) < 5) return;
        draggingObject = true;
        const dx = px*size.width/rect.width;
        const dy = py*size.height/rect.height;
        if (mode === 'move') {
          current = {...origin,
            x:Math.max(-origin.w*.9,Math.min(size.width*.98,origin.x+dx)),
            y:Math.max(-origin.h*.9,Math.min(size.height*.98,origin.y+dy)),
          };
        } else {
          const w = Math.max(size.width*.02,Math.min(size.width*2,origin.w+dx));
          const h = Math.max(size.height*.02,Math.min(size.height*2,origin.h+dy));
          if (target.kind === 'picture' && origin.h && origin.w) {
            const factor = Math.abs(dx/origin.w) > Math.abs(dy/origin.h) ? w/origin.w : h/origin.h;
            current = {...origin,w:origin.w*factor,h:origin.h*factor};
          } else current = {...origin,w,h};
        }
        place(frame,current,rotation);
        place(handles,current,rotation);
      };
      const end = event => {
        if (event.pointerId !== start.pointerId) return;
        control.removeEventListener('pointermove',onMove);
        control.removeEventListener('pointerup',end);
        control.removeEventListener('pointercancel',end);
        draggingObject = false;
        if (event.type === 'pointerup' && current && !gesture?.span) {
          dragMode = '';
          void change(() => setShapeBounds(target.shape,{
            x:emu(current.x),y:emu(current.y),w:emu(current.w),h:emu(current.h),
          }));
        } else {
          place(frame,origin,rotation);
          place(handles,origin,rotation);
        }
      };
      control.addEventListener('pointermove',onMove);
      control.addEventListener('pointerup',end);
      control.addEventListener('pointercancel',end);
    });
  }
  stage.addEventListener('click',async event => {
    if (pending || gesture?.span || ![stage,overlay].includes(event.target)) return;
    try {
      await flush();
      selectedId = undefined;
      selectedTarget = undefined;
      handles(objects(model.presentation,currentSlide()));
    } catch (error) { status(error.message,true); }
  });
  function keyboard(event) {
    if (event.defaultPrevented || event.isComposing || !wrap.isConnected || pending) return;
    const key = event.key;
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && key.toLowerCase() === 's') {
      event.preventDefault();
      document.querySelector('#save')?.click();
      return;
    }
    if (editShape && (key === 'Escape' || ctrl && key === 'Enter')) {
      event.preventDefault();
      if (key === 'Escape') hideText();
      else void flush().catch(error => status(error.message,true));
      viewport.focus({preventScroll:true});
      return;
    }
    if (event.target.closest?.('textarea,input,select,[contenteditable],.slide-tabs')) return;
    if (ctrl && key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      void undoEdit();
    } else if (key === 'PageUp' || key === 'PageDown') {
      event.preventDefault();
      void go(index+(key === 'PageUp' ? -1 : 1));
    } else if (selectedTarget && key === 'Delete') {
      event.preventDefault();
      remove.click();
    } else if (selectedTarget?.text && key === 'F2') {
      event.preventDefault();
      showText();
    } else if (selectedTarget?.movable && /^Arrow(Up|Down|Left|Right)$/.test(key)) {
      event.preventDefault();
      if (event.repeat) return;
      const target = selectedTarget;
      const distance = event.shiftKey ? 127000 : 12700;
      const {x,y,w,h} = target.bounds;
      const dx = key === 'ArrowLeft' ? -distance : key === 'ArrowRight' ? distance : 0;
      const dy = key === 'ArrowUp' ? -distance : key === 'ArrowDown' ? distance : 0;
      void change(() => setShapeBounds(target.shape,{
        x:emu(x+dx),y:emu(y+dy),w:emu(w),h:emu(h),
      }));
    }
  }
  document.addEventListener('keydown',keyboard);
  function updateTools() {
    if (!selectedTarget?.movable) dragMode = '';
    wrap.classList.toggle('moving-shape',dragMode !== '');
    changeText.disabled = !selectedTarget?.text;
    dragging.disabled = !selectedTarget?.movable;
    dragging.setAttribute('aria-pressed',String(dragMode === 'move'));
    resize.disabled = !selectedTarget?.movable;
    resize.setAttribute('aria-pressed',String(dragMode === 'resize'));
    remove.disabled = !selectedTarget || isShapeLocked(selectedTarget.shape);
    undo.disabled = !model.undo.length;
    previous.disabled = index === 0;
    next.disabled = index === slideList().length-1;
    moveUp.disabled = previous.disabled;
    moveDown.disabled = next.disabled;
    deleteSlide.disabled = slideList().length < 2;
  }
  function repaint(rebuild) {
    const turn = ++paintGeneration;
    const slide = currentSlide();
    const list = objects(model.presentation,slide);
    selectedTarget = list.find(target => target.id === selectedId);
    handles(list);
    slideNumber.textContent = (index+1) + ' / ' + slideList().length;
    artwork.alt = getSlideTitle(slide) || (index+1)+'번 슬라이드';
    if (rebuild) buildThumbs();
    [...thumbs.children].forEach((item,i) => item.setAttribute('aria-current',String(i===index)));
    const current = thumbs.children[index];
    if (current) current.scrollIntoView({block:'nearest',inline:'nearest'});
    updateTools();
    // Yield once so slide navigation and shape feedback can paint before rendering.
    requestAnimationFrame(() => {
      if (turn !== paintGeneration || !wrap.isConnected) return;
      try {
        const url = bitmap(slide);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = url; artwork.src = url; stage.classList.remove('preview-error');
      } catch (error) {
        artwork.removeAttribute('src'); stage.classList.add('preview-error');
        status('이 슬라이드의 미리보기를 표시할 수 없습니다.',true);
      }
    });
  }
  model.flush = flush;
  model.hasDraft = hasDraft;
  repaint(true);
  return () => {
    paintGeneration++;
    document.removeEventListener('keydown',keyboard);
    releaseThumbs();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    model.flush = undefined; model.hasDraft = undefined;
  };
}
