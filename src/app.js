import './style.css';
import { FILE_LIMIT, openOffice, columnName, sheetCells } from './ooxml.js';
import { patchableHwpx, textDelta } from './hwpx.js';
import { encodeTable, encodeText, openText, readTable } from './text-files.js';
import { openDocx } from './docx.js';
import { confirmAction, UserError, userMessage } from './ui-messages.js';

const byId = id => document.getElementById(id);
const home = byId('home');
const workspace = byId('workspace');
const editor = byId('editor');
const picker = byId('picker');
const saveButton = byId('save');
const accepted = new Set(['hwp','hwpx','pptx','xlsx','pdf','docx','csv','tsv','txt','md']);
const allTypes = [...accepted].map(extension => '.' + extension).join(',');
const officeTypes = new Set(['docx','xlsx','pptx']);
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
async function canSwitch() {
  return !busy && (!(active?.dirty || active?.deck?.hasDraft?.()) ||
    await confirmAction('저장하지 않은 변경 사항이 있습니다. 문서를 닫을까요?','닫기'));
}
async function showHome() {
  if (!await canSwitch() || busy) return;
  releaseDocument(active);
  active = null;
  editor.replaceChildren();
  removePreview();
  workspace.hidden = true;
  home.hidden = false;
  document.body.classList.remove('editing');
  status('');
}

function releaseDocument(file) {
  file?.doc?.free();
  file?.unmount?.();
  if (file?.pdf) void file.pdf.dispose().catch(() => {});
}

function renderPlain(file) {
  const panel = el('div',undefined,'panel');
  const label = field('본문', file.text.value, value => {
    file.text.value = value;
    edit();
  });
  label.querySelector('textarea').classList.add('plain-textarea');
  panel.append(label);
  editor.append(panel);
}

function renderWord(word) {
  const panel = el('div',undefined,'panel');
  const controls = el('div',undefined,'controls');
  const fields = el('div',undefined,'fields');
  const note = word.protectedDocument ? '편집 보호가 설정된 문서입니다.' :
    '본문 텍스트를 편집합니다. 문서에 포함된 서식과 개체는 사본에 유지됩니다.';
  panel.append(el('p',note,'note'),controls,fields);
  editor.append(panel);
  viewport(controls, page => {
    fields.replaceChildren();
    word.paragraphs.slice(page*24,page*24+24).forEach((nodes,index) => {
      let previous = nodes.map(node => node.textContent).join('');
      const label = field('본문 문단 ' + (page*24+index+1),previous,word.protectedDocument ? null : value => {
        word.update(nodes, previous, value);
        previous = value;
        edit();
      });
      fields.append(label);
    });
    if (!fields.hasChildNodes()) fields.append(el('p','편집할 본문 텍스트가 없습니다.'));
  }, () => Math.ceil(word.paragraphs.length/24));
}

function renderTable(table) {
  const controls = el('div',undefined,'controls');
  const scroll = el('div',undefined,'sheet-wrap');
  editor.append(controls,scroll);
  const columns = Math.max(1,table.rows.reduce((count,row) => Math.max(count,row.length),0));
  const maxColumns = Math.min(256,columns + 1);
  const columnPick = choose(Array.from({length: Math.ceil(maxColumns / 12)}, (_, i) =>
    columnName(i * 12) + '–' + columnName(Math.min(maxColumns - 1,i*12+11))), '열 범위', value => {
    columnGroup = value;
    refresh();
  });
  let columnGroup = 0;
  controls.append(columnPick);
  const refresh = viewport(controls,page => {
    const grid = el('table',undefined,'grid');
    const header = grid.createTHead().insertRow();
    header.append(el('th','#'));
    const last = Math.min(maxColumns,columnGroup*12+12);
    for (let column=columnGroup*12; column<last; column++) header.append(el('th',columnName(column)));
    const body = grid.createTBody();
    for (let index=page*30; index<Math.min(table.rows.length+1,page*30+30); index++) {
      const row = body.insertRow();
      row.append(el('th',String(index+1)));
      for (let column=columnGroup*12; column<last; column++) {
        const cell = row.insertCell();
        const input = el('input');
        input.value = table.rows[index]?.[column] || '';
        input.setAttribute('aria-label',columnName(column)+(index+1));
        input.addEventListener('change',() => {
          if (input.value === (table.rows[index]?.[column] || '')) return;
          const values = table.rows[index] ||= [];
          while (values.length <= column) values.push('');
          values[column] = input.value;
          edit();
        });
        cell.append(input);
      }
    }
    scroll.replaceChildren(grid);
  }, () => Math.ceil((table.rows.length+1)/30));
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
    catch (error) { scroll.replaceChildren(el('p',userMessage(error,'이 시트를 표시할 수 없습니다.'))); return; }
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
  split.classList.add('hwp-workspace');
  const view = el('div',undefined,'controls hwp-switcher');
  const editTab = button('본문 편집',() => selectPanel('text'));
  const previewTab = button('쪽 미리보기',() => selectPanel('preview'));
  function selectPanel(panel) {
    split.dataset.panel = panel;
    editTab.setAttribute('aria-pressed',String(panel === 'text'));
    previewTab.setAttribute('aria-pressed',String(panel === 'preview'));
  }
  view.append(editTab,previewTab);
  selectPanel('text');
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
          } catch (error) { status(userMessage(error,'문단을 편집할 수 없습니다.'),true); }
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
  editor.append(view,split);
  jump();
}

function renderDocument(file) {
  if (file.pdf) {
    file.unmount = file.pdfModule.renderPdf(editor,file.pdf,{
      el,button,status,changed:dirty => { file.dirty = dirty; },
    });
  } else if (file.deck) {
    file.unmount = file.slideModule.renderSlides(editor,file.deck,{
      el,button,status,changed:() => { file.dirty = true; },
    });
  } else if (file.doc) renderHwp(file.doc,file.hwpx);
  else if (file.word) renderWord(file.word);
  else if (file.table) renderTable(file.table);
  else if (file.text) renderPlain(file);
  else renderWorkbook(file.office);
}

async function openDocument(name, bytes) {
  if (!await canSwitch() || busy) return;
  const extension = name.split('.').pop().toLowerCase();
  if (!accepted.has(extension)) {
    status('이 파일 형식은 열 수 없습니다. ' + [...accepted].map(value => value.toUpperCase()).join(', '), true);
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
        if (!next.hwpx) throw new UserError('지원하는 HWPX 섹션 구성을 찾지 못했습니다.');
      }
    } else if (extension === 'pdf') {
      if (!bytes) throw new UserError('PDF 파일을 선택하세요.');
      const pdfModule = await import('./pdf.js');
      const pdf = await pdfModule.openPdf(bytes);
      next = {name,extension,pdf,pdfModule,original:bytes};
    } else if (extension === 'pptx') {
      const slideModule = await import('./slides.js');
      const input = bytes || new Uint8Array(await (await fetch('./blank.pptx')).arrayBuffer());
      next = {name,extension,deck:await slideModule.openSlides(input),slideModule,original:input};
    } else if (extension === 'docx') {
      const input = bytes || new Uint8Array(await (await fetch('./blank.docx')).arrayBuffer());
      next = {name,extension,word:openDocx(input),original:input};
    } else if (['csv','tsv','txt','md'].includes(extension)) {
      const text = openText(bytes);
      next = ['csv','tsv'].includes(extension) ?
        {name,extension,table:readTable(text,extension),original:bytes} :
        {name,extension,text,original:bytes};
    } else {
      const input = bytes || new Uint8Array(await (await fetch('./blank.' + extension)).arrayBuffer());
      next = {name, extension, office: openOffice(input), original: input};
    }
    previous?.unmount?.();
    editor.replaceChildren();
    removePreview();
    active = next;
    byId('filename').textContent = name;
    byId('filename').title = name;
    workspace.hidden = false;
    home.hidden = true;
    document.body.classList.add('editing');
    status('');
    renderDocument(next);
    releaseDocument(previous);
    status('');
  } catch (error) {
    releaseDocument(next);
    active = previous;
    if (next && previous) {
      editor.replaceChildren();
      byId('filename').textContent = previous.name;
      byId('filename').title = previous.name;
      renderDocument(previous);
    } else if (next) {
      workspace.hidden = true;
      home.hidden = false;
      document.body.classList.remove('editing');
    }
    status(userMessage(error,'파일을 열 수 없습니다. 파일 형식과 상태를 확인하세요.'),true);
  } finally { busy = false; }
}
async function serialize() {
  if (!active.dirty && active.original) return active.original;
  if (active.office) return active.office.serialize();
  if (active.hwpx) return active.hwpx.serialize();
  if (active.word) return active.word.serialize();
  if (active.table) return encodeTable(active.table);
  if (active.text) return encodeText(active.text,active.text.value);
  if (active.pdf) return active.pdfModule.savePdf(active.pdf,active.original);
  if (active.deck) return active.slideModule.saveSlides(active.deck);
  const result = active.extension === 'hwp' ? active.doc.exportHwpWithReport() : active.doc.exportHwpxWithReport();
  try {
    if (!result.hasBytes()) throw new UserError('이 문서를 안전하게 저장할 수 없습니다.');
    const report = JSON.parse(result.contentLoss());
    if ((report.entries?.length || report.dropped?.length || report.losses?.length) &&
        !await confirmAction('한글 엔진에서 일부 요소의 손실 가능성을 보고했습니다. 편집한 사본을 저장할까요?','저장')) return null;
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
  editor.inert = false;
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
  editor.inert = true;
  try {
    await active.deck?.flush?.();
    const bytes = await serialize();
    if (!bytes) { window.nanaSaveResult('cancelled'); return; }
    const fallback = '편집 문서.' + active.extension;
    const name = (active.name.split('.').slice(0,-1).join('.') + ' - 편집.' + active.extension) || fallback;
    if (window.NanaAndroid) window.NanaAndroid.save(name, base64(bytes));
    else if (window.nanaDesktop) {
      const result = await window.nanaDesktop.save(name,bytes);
      if (typeof result === 'string') window.nanaSaveResult(result);
      else window.nanaSaveResult(result.status,result.detail);
    }
    else {
      const url = URL.createObjectURL(new Blob([bytes]));
      const link = el('a'); link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      window.nanaSaveResult('saved');
    }
  } catch (error) { window.nanaSaveResult('error',userMessage(error,'저장 위치와 파일 상태를 확인하세요.')); }
}
async function accept(file) {
  if (!file || busy) return;
  if (window.nanaDesktop?.openDroppedOffice && officeTypes.has(file.name.split('.').pop().toLowerCase())) {
    await launchDesktopOffice(() => window.nanaDesktop.openDroppedOffice(file));
    return;
  }
  if (file.size > FILE_LIMIT) { status('48MB 이하의 파일을 선택하세요.', true); return; }
  try { await openDocument(file.name, new Uint8Array(await file.arrayBuffer())); }
  catch (error) { status(userMessage(error,'파일을 읽지 못했습니다.'),true); }
}
async function chooseFile(types = allTypes) {
  if (busy) return;
  if (window.nanaDesktop?.pickFile) {
    try {
      const picked = await window.nanaDesktop.pickFile(types === '.pdf' ? 'pdf' : 'document');
      if (picked?.opened || picked?.error) officeResult(picked);
      else if (picked) await openDocument(picked.name,picked.bytes);
    } catch (error) { status(userMessage(error,'파일 선택 창을 열 수 없습니다.'),true); }
    return;
  }
  picker.accept = types;
  picker.click();
}
byId('open').onclick = () => chooseFile();
byId('open-pdf').onclick = () => chooseFile('.pdf');
picker.onchange = () => { const file = picker.files[0]; picker.value = ''; void accept(file); };
byId('home-button').onclick = showHome;
saveButton.onclick = save;
document.querySelectorAll('[data-new]').forEach(card => card.onclick = () => {
  const ext = card.dataset.new;
  if (window.nanaDesktop?.launchOffice && officeTypes.has(ext)) {
    void launchDesktopOffice(() => window.nanaDesktop.launchOffice(ext));
    return;
  }
  const names = {hwpx:'새 한글 문서',xlsx:'새 스프레드시트',pptx:'새 프레젠테이션',docx:'새 워드 문서',txt:'새 텍스트 문서'};
  void openDocument(names[ext] + '.' + ext, null);
});
document.addEventListener('keydown', event => {
  if (event.target.closest?.('#app-confirmation')) return;
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
  if (event.key.toLowerCase() === 'o') { event.preventDefault(); chooseFile(); }
});
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => { event.preventDefault(); void accept(event.dataTransfer.files[0]); });
window.addEventListener('beforeunload', event => {
  if (active?.dirty || active?.deck?.hasDraft?.()) { event.preventDefault(); event.returnValue = ''; }
});
function officeResult(result) {
  if (result?.error) status(result.error,true);
  else if (result?.opened) status('오피스 편집 창을 열었습니다.');
}
let openingOffice = false;
async function launchDesktopOffice(open) {
  if (openingOffice) return;
  openingOffice = true;
  status('오피스 편집기를 여는 중입니다.');
  try { officeResult(await open()); }
  catch (error) { status(userMessage(error,'오피스 편집기를 열지 못했습니다.'),true); }
  finally { openingOffice = false; }
}
if (window.nanaDesktop) {
  const officeEditor = byId('office-editor');
  officeEditor.hidden = !window.nanaDesktop.launchOffice;
  officeEditor.onclick = () => launchDesktopOffice(() => window.nanaDesktop.launchOffice('home'));
  window.nanaDesktop.onOfficeResult?.(officeResult);
  window.nanaDesktop.onProgress(text => status(text));
  window.nanaDesktop.onOpen((name, bytes) => void openDocument(name, bytes));
  window.nanaDesktop.ready();
}
