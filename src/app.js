import './style.css';
import { FILE_LIMIT, openOffice, columnName, sheetCells, slideFields } from './ooxml.js';
import { patchableHwpx, textDelta } from './hwpx.js';

const byId = id => document.getElementById(id);
const home = byId('home');
const workspace = byId('workspace');
const editor = byId('editor');
const picker = byId('picker');
const saveButton = byId('save');
let active = null;
let busy = false;
let previewURL;
let hwpEngine;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, action) {
  const node = el('button', text);
  node.addEventListener('click', action);
  return node;
}
function status(message, error = false) {
  const node = byId('status');
  node.textContent = message;
  node.classList.toggle('error', error);
}
function choose(values, label, change) {
  const select = el('select');
  select.setAttribute('aria-label', label);
  values.forEach((name, index) => {
    const option = el('option', name);
    option.value = index;
    select.append(option);
  });
  select.addEventListener('change', () => change(Number(select.value)));
  return select;
}
function field(label, value, edit) {
  const wrapper = el('label', label, 'field');
  const input = el('textarea');
  input.value = value;
  input.spellcheck = false;
  if (edit) input.addEventListener('input', () => edit(input.value));
  else input.readOnly = true;
  wrapper.append(input);
  return wrapper;
}
function edit() {
  active.dirty = true;
}
function removePreview() {
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = undefined;
}
function canSwitch() {
  return !busy && (!active?.dirty || confirm('저장하지 않은 변경 사항이 있습니다. 문서를 닫을까요?'));
}
function showHome() {
  if (!canSwitch()) return;
  active?.doc?.free();
  active = null;
  editor.replaceChildren();
  removePreview();
  workspace.hidden = true;
  home.hidden = false;
  status('');
}
function viewport(selector, change, max, initially = 0) {
  let page = initially;
  const count = el('span');
  const back = button('이전', () => show(page - 1));
  const next = button('다음', () => show(page + 1));
  const bounds = () => Math.max(1, max());
  function show(value) {
    page = Math.min(Math.max(value, 0), bounds() - 1);
    count.textContent = (page + 1) + ' / ' + bounds();
    back.disabled = page <= 0;
    next.disabled = page + 1 >= bounds();
    change(page);
  }
  selector.append(back, count, next);
  show(page);
  return () => show(page);
}

function renderSlides(office) {
  const controls = el('div', undefined, 'controls');
  const panel = el('div', undefined, 'panel');
  const fields = el('div', undefined, 'fields');
  const note = el('p','기존 슬라이드의 텍스트를 편집합니다. 이미지와 도형은 파일에 유지됩니다.','note');
  function show(index) {
    const part = office.parts[index];
    const nodes = slideFields(part);
    fields.replaceChildren(...nodes.map((node, position) => field('텍스트 ' + (position + 1), node.textContent, value => {
      node.textContent = value;
      if (/^\s|\s$/.test(value)) node.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');
      office.modified(part);
      edit();
    })));
    if (!nodes.length) fields.append(el('p', '이 슬라이드에 편집할 텍스트가 없습니다.'));
  }
  controls.append(choose(office.parts.map(part => part.name), '슬라이드', show));
  panel.append(note, fields);
  editor.append(controls, panel);
  show(0);
}

function renderWorkbook(office) {
  const controls = el('div', undefined, 'controls');
  const scroll = el('div', undefined, 'sheet-wrap');
  const note = el('p','셀 값을 편집합니다. 기존 수식은 읽기 전용이며, 수식 계산은 Excel 또는 ONLYOFFICE에서 확인할 수 있습니다.','note');
  let index = 0;
  let startRow = 1;
  let startColumn = 1;
  const rowControl = document.createElement('input');
  rowControl.type = 'number'; rowControl.min = 1; rowControl.max = 1048576; rowControl.value = 1;
  const colControl = document.createElement('input');
  colControl.type = 'number'; colControl.min = 1; colControl.max = 16384; colControl.value = 1;
  rowControl.setAttribute('aria-label', '시작 행 번호');
  colControl.setAttribute('aria-label', '시작 열 번호');
  function show() {
    const part = office.parts[index];
    const table = el('table', undefined, 'grid');
    const heading = table.createTHead().insertRow();
    heading.append(el('th', '#'));
    const columns = Math.min(10, 16385 - startColumn);
    for (let column = 0; column < columns; column++) heading.append(el('th', columnName(startColumn + column - 1)));
    const rows = table.createTBody();
    let grid;
    try { grid = sheetCells(part); }
    catch (error) { scroll.replaceChildren(el('p', error.message)); return; }
    for (let i = startRow; i < Math.min(1048577, startRow + 30); i++) {
      const row = rows.insertRow();
      row.append(el('th', String(i)));
      for (let j = startColumn - 1; j < startColumn - 1 + columns; j++) {
        const cell = row.insertCell();
        const input = document.createElement('input');
        const address = columnName(j) + i;
        const existing = grid.read(address, office.strings);
        input.value = existing.value;
        input.readOnly = existing.readonly;
        input.setAttribute('aria-label', address);
        input.addEventListener('change', () => {
          if (input.value === existing.value) return;
          grid.write(i, j, input.value);
          existing.value = input.value;
          office.modified(part);
          edit();
        });
        cell.append(input);
      }
    }
    scroll.replaceChildren(table);
  }
  controls.append(choose(office.parts.map(part => part.name), '시트', value => { index = value; show(); }));
  const rowLabel = el('label', '시작 행 ');
  const columnLabel = el('label', '시작 열 ');
  rowLabel.append(rowControl); columnLabel.append(colControl);
  controls.append(rowLabel, columnLabel, button('이동', () => {
    startRow = Math.min(1048576, Math.max(1, Math.trunc(Number(rowControl.value)) || 1));
    startColumn = Math.min(16384, Math.max(1, Math.trunc(Number(colControl.value)) || 1));
    rowControl.value = startRow; colControl.value = startColumn;
    show();
  }));
  editor.append(controls, note, scroll);
  show();
}

async function openHwp(bytes) {
  if (!hwpEngine) {
    const engine = await import('@rhwp/core');
    await engine.default();
    hwpEngine = engine;
  }
  return bytes ? new hwpEngine.HwpDocument(bytes) : hwpEngine.HwpDocument.createEmpty();
}
function changeText(doc, sec, para, oldValue, value) {
  const { start, end, inserted } = textDelta(oldValue, value);
  const removed = end - start;
  if (removed) doc.deleteText(sec, para, start, removed);
  if (inserted) doc.insertText(sec, para, start, inserted);
}
function renderHwp(doc, hwpx) {
  const split = el('div', undefined, 'split');
  const page = el('div', undefined, 'panel preview');
  const pageBar = el('div', undefined, 'controls');
  const image = el('img');
  image.alt = '한글 문서 미리보기';
  page.append(pageBar, image);
  const refresh = viewport(pageBar, index => {
    removePreview();
    previewURL = URL.createObjectURL(new Blob([doc.renderPageSvg(index)], { type:'image/svg+xml' }));
    image.src = previewURL;
  }, () => doc.pageCount());

  const textPanel = el('div', undefined, 'panel');
  const controls = el('div', undefined, 'controls');
  const paragraphs = el('div', undefined, 'fields');
  const paragraphBar = el('div', undefined, 'controls');
  const rootControls = JSON.parse(doc.getControls()).filter(control => control.list === 0);
  let section = 0;
  let first = 0;
  function showParagraphs() {
    paragraphs.replaceChildren();
    const count = doc.getParagraphCount(section);
    for (let para = first; para < Math.min(count, first + 30); para++) {
      const selectedSection = section;
      const length = doc.getParagraphLength(selectedSection, para);
      let value = doc.getTextRange(selectedSection, para, 0, length);
      const positions = JSON.parse(doc.getControlTextPositions(selectedSection, para));
      const layoutControls = rootControls.filter(control => control.para === para);
      const layoutOnly = selectedSection === 0 && positions.length === layoutControls.length &&
        layoutControls.every(control => ['secd','cold'].includes(control.ctrlId));
      const editable = (positions.length === 0 || layoutOnly) && Array.from(value).length === length &&
        (!hwpx || hwpx.canEdit(selectedSection, para, value));
      const label = field('본문 문단 ' + (para + 1) + (editable ? '' : ' · 읽기 전용'), value, null);
      if (editable) {
        const input = label.querySelector('textarea');
        input.readOnly = false;
        input.addEventListener('change', () => {
          try {
            const next = input.value.replace(/[\r\n]+/g,' ');
            if (next !== value) {
              changeText(doc, selectedSection, para, value, next);
              hwpx?.update(selectedSection, para, value, next);
              value = next;
              edit();
              refresh();
            }
            input.value = value;
          } catch (error) { status('문단을 편집할 수 없습니다. ' + error.message, true); }
        });
      }
      paragraphs.append(label);
    }
  }
  const jump = () => pageParagraphs();
  controls.append(choose(Array.from({length:doc.getSectionCount()}, (_, index) => '구역 ' + (index + 1)), '문서 구역', value => {
    section = value; first = 0; jump();
  }));
  const previous = button('이전 문단', () => { first -= 30; jump(); });
  const next = button('다음 문단', () => { first += 30; jump(); });
  const add = button('문단 추가', () => {
    const last = doc.getParagraphCount(section) - 1;
    doc.splitParagraph(section, last, doc.getParagraphLength(section, last));
    first = Math.floor((last + 1) / 30) * 30;
    edit(); refresh(); jump();
    paragraphs.lastElementChild?.querySelector('textarea')?.focus();
  });
  paragraphBar.append(previous, next);
  if (!hwpx) paragraphBar.append(add);
  function pageParagraphs() {
    previous.disabled = first === 0;
    next.disabled = first + 30 >= doc.getParagraphCount(section);
    showParagraphs();
  }
  textPanel.append(controls, el('p','본문 문단을 편집합니다. 표와 개체가 있는 문단은 미리보기에서 확인할 수 있습니다.','note'), paragraphBar, paragraphs);
  split.append(page, textPanel);
  editor.append(split);
  jump();
}
async function openDocument(name, bytes) {
  if (!canSwitch()) return;
  const extension = name.split('.').pop().toLowerCase();
  if (!['hwp','hwpx','pptx','xlsx'].includes(extension)) {
    status('HWP, HWPX, XLSX, PPTX 파일을 선택하세요.', true);
    return;
  }
  if (bytes?.byteLength > FILE_LIMIT) {
    status('48MB 이하의 파일을 선택하세요.', true);
    return;
  }
  let next;
  let previous = active;
  busy = true;
  status('파일을 여는 중…');
  try {
    if (extension === 'hwp' || extension === 'hwpx') {
      next = { name, extension, doc: await openHwp(bytes), original: bytes };
      if (extension === 'hwpx' && bytes) {
        next.hwpx = patchableHwpx(bytes, next.doc.getSectionCount());
        if (!next.hwpx) throw Error('지원하는 HWPX 섹션 구성을 찾지 못했습니다.');
      }
    }
    else {
      const input = bytes || new Uint8Array(await (await fetch('./blank.' + extension)).arrayBuffer());
      next = {name, extension, office: openOffice(input, extension), original: input};
    }
    editor.replaceChildren();
    removePreview();
    active = next;
    if (next.doc) renderHwp(next.doc, next.hwpx);
    else if (extension === 'xlsx') renderWorkbook(next.office);
    else renderSlides(next.office);
    byId('filename').textContent = name;
    workspace.hidden = false;
    home.hidden = true;
    previous?.doc?.free();
    status('');
  } catch (error) {
    next?.doc?.free();
    active = previous;
    if (next && previous) {
      editor.replaceChildren();
      if (previous.doc) renderHwp(previous.doc, previous.hwpx);
      else if (previous.extension === 'xlsx') renderWorkbook(previous.office);
      else renderSlides(previous.office);
    }
    status('파일을 열 수 없습니다. ' + (error.message || String(error)), true);
  } finally { busy = false; }
}
function serialize() {
  if (!active.dirty && active.original) return active.original;
  if (active.office) return active.office.serialize();
  if (active.hwpx) return active.hwpx.serialize();
  const result = active.extension === 'hwp' ? active.doc.exportHwpWithReport() : active.doc.exportHwpxWithReport();
  try {
    if (!result.hasBytes()) throw Error('이 문서를 안전하게 저장할 수 없습니다.');
    const report = JSON.parse(result.contentLoss());
    if ((report.entries?.length || report.dropped?.length || report.losses?.length) &&
        !confirm('한글 엔진에서 일부 요소의 손실 가능성을 보고했습니다. 편집한 사본을 저장할까요?')) return null;
    return result.takeBytes();
  } finally { result.free(); }
}
function base64(bytes) {
  let raw = '';
  for (let offset = 0; offset < bytes.length; offset += 0x4000) {
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 0x4000));
  }
  return btoa(raw);
}
window.nanaSaveResult = (result, detail) => {
  busy = false;
  saveButton.disabled = false;
  if (result === 'saved') {
    active.dirty = false;
    status('편집한 파일을 저장했습니다.');
  } else if (result === 'cancelled') status('저장을 취소했습니다.');
  else status('파일을 저장하지 못했습니다. ' + (detail || ''), true);
};
async function save() {
  if (!active || busy) return;
  document.activeElement?.blur();
  busy = true;
  saveButton.disabled = true;
  try {
    const bytes = serialize();
    if (!bytes) { window.nanaSaveResult('cancelled'); return; }
    const fallback = '편집 문서.' + active.extension;
    const name = (active.name.split('.').slice(0,-1).join('.') + ' - 편집.' + active.extension) || fallback;
    if (window.NanaAndroid) window.NanaAndroid.save(name, base64(bytes));
    else if (window.nanaDesktop) window.nanaSaveResult(await window.nanaDesktop.save(name, bytes));
    else {
      const url = URL.createObjectURL(new Blob([bytes]));
      const link = el('a'); link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      window.nanaSaveResult('saved');
    }
  } catch (error) { window.nanaSaveResult('error', error.message || String(error)); }
}
async function accept(file) {
  if (!file || busy) return;
  if (file.size > FILE_LIMIT) { status('48MB 이하의 파일을 선택하세요.', true); return; }
  try { await openDocument(file.name, new Uint8Array(await file.arrayBuffer())); }
  catch (error) { status('파일을 읽지 못했습니다. ' + error.message,true); }
}
byId('open').onclick = () => picker.click();
picker.onchange = () => { const file = picker.files[0]; picker.value = ''; void accept(file); };
byId('home-button').onclick = showHome;
saveButton.onclick = save;
document.querySelectorAll('[data-new]').forEach(card => card.onclick = () => {
  const ext = card.dataset.new;
  const names = {hwpx:'새 한글 문서',xlsx:'새 스프레드시트',pptx:'새 프레젠테이션'};
  void openDocument(names[ext] + '.' + ext, null);
});
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
  if (event.key.toLowerCase() === 'o') { event.preventDefault(); picker.click(); }
});
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => { event.preventDefault(); void accept(event.dataTransfer.files[0]); });
window.addEventListener('beforeunload', event => {
  if (active?.dirty) { event.preventDefault(); event.returnValue = ''; }
});
if (window.nanaDesktop) {
  const advanced = byId('advanced');
  advanced.hidden = false;
  advanced.onclick = async () => {
    advanced.disabled = true;
    try { status(''); await window.nanaDesktop.openAdvanced(); }
    catch (error) { status('ONLYOFFICE를 열지 못했습니다. ' + error.message,true); }
    finally { advanced.disabled = false; }
  };
  window.nanaDesktop.onProgress(text => status(text));
  window.nanaDesktop.onOpen((name, bytes) => void openDocument(name, bytes));
  window.nanaDesktop.ready();
}
