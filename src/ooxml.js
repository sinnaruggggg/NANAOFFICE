import { unzipSync, zipSync } from 'fflate';

const utf8 = new TextEncoder();
const parser = new DOMParser();
const writer = new XMLSerializer();
const XLS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const DRAW = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = 'http://www.w3.org/XML/1998/namespace';
export const FILE_LIMIT = 48 * 1024 * 1024;

function children(node, name) {
  return Array.from(node.children).filter(child => child.localName === name);
}
function elements(node, ns, name) {
  return Array.from(node.getElementsByTagNameNS(ns, name));
}
function readXml(files, path) {
  const data = files[path];
  if (!data) throw Error('문서 요소를 찾을 수 없습니다.');
  const encoding = data[0] === 255 && data[1] === 254 ? 'utf-16le' :
    data[0] === 254 && data[1] === 255 ? 'utf-16be' : 'utf-8';
  const content = new TextDecoder(encoding, { fatal: true }).decode(data);
  if (/<!DOCTYPE/i.test(content)) throw Error('지원하지 않는 XML 선언입니다.');
  const xml = parser.parseFromString(content, 'application/xml');
  if (xml.querySelector('parsererror')) throw Error('문서 XML을 읽을 수 없습니다.');
  return xml;
}
function partPath(base, target) {
  if (!target || target.includes('\\') || /^[a-z][a-z\d+.-]*:/i.test(target)) throw Error('잘못된 문서 경로입니다.');
  const url = new URL(target, 'https://package.invalid/' + base);
  if (url.hostname !== 'package.invalid' || url.search || url.hash) throw Error('잘못된 문서 경로입니다.');
  return decodeURIComponent(url.pathname.slice(1));
}

function parts(files, key, tag, rootPath, relationshipPath) {
  const root = readXml(files, rootPath);
  const rels = readXml(files, relationshipPath);
  const targets = new Map(children(rels.documentElement, 'Relationship')
    .filter(relation => relation.getAttribute('TargetMode') !== 'External')
    .map(relation => [relation.getAttribute('Id'), relation.getAttribute('Target')]));
  return {
    root,
    list: elements(root, root.documentElement.namespaceURI, tag).map((element, index) => {
      const id = element.getAttributeNS(REL, 'id') || element.getAttribute('r:id');
      const path = partPath(key, targets.get(id));
      return { name: element.getAttribute('name') || '슬라이드 ' + (index + 1), path, xml: readXml(files, path) };
    }),
  };
}
export function openOffice(bytes, extension) {
  let total = 0;
  let count = 0;
  const files = unzipSync(bytes, { filter(file) {
    total += file.originalSize;
    if (++count > 12000 || total > 192 * 1024 * 1024) throw Error('압축을 푼 문서가 너무 큽니다.');
    if (file.name.split('/').some(part => part === '..') || file.name.startsWith('/')) throw Error('잘못된 압축 파일 경로입니다.');
    return true;
  }});
  const structure = extension === 'xlsx'
    ? parts(files, 'xl/', 'sheet', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels')
    : parts(files, 'ppt/', 'sldId', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels');
  if (!structure.list.length) throw Error('편집할 시트 또는 슬라이드가 없습니다.');
  const strings = files['xl/sharedStrings.xml']
    ? elements(readXml(files, 'xl/sharedStrings.xml'), XLS, 'si')
      .map(entry => elements(entry, XLS, 't').map(item => item.textContent).join(''))
    : [];
  const changed = new Set();
  return {
    parts: structure.list, strings,
    modified(part) { changed.add(part); },
    serialize() {
      for (const part of changed) files[part.path] = utf8.encode(writer.serializeToString(part.xml.documentElement));
      if (extension === 'xlsx' && changed.size) {
        const root = structure.root.documentElement;
        let calc = children(root, 'calcPr')[0];
        if (calc) {
          calc.setAttribute('fullCalcOnLoad', '1');
          files['xl/workbook.xml'] = utf8.encode(writer.serializeToString(root));
        }
      }
      return zipSync(files, { level: 3 });
    },
  };
}

export function slideFields(part) {
  return elements(part.xml, DRAW, 't').filter(node => node.parentElement.localName === 'r');
}

export function columnName(index) {
  let name = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + (value - 1) % 26) + name;
  }
  return name;
}
function columnIndex(reference) {
  let value = 0;
  for (const char of reference.match(/^[A-Z]+/)?.[0] || '') value = value * 26 + char.charCodeAt(0) - 64;
  return value;
}
export function sheetCells(part) {
  if (part.xml.documentElement.localName !== 'worksheet') throw Error('차트 전용 시트는 편집할 수 없습니다.');
  const sheet = elements(part.xml, XLS, 'sheetData')[0];
  const rows = new Map(children(sheet, 'row').map(row => [Number(row.getAttribute('r')), row]));
  const cells = new Map(elements(sheet, XLS, 'c').map(cell => [cell.getAttribute('r'), cell]));
  const protectedSheet = elements(part.xml, XLS, 'sheetProtection').length > 0;
  return {
    read(ref, strings) {
      const cell = cells.get(ref);
      const type = cell?.getAttribute('t');
      const value = cell && children(cell, 'v')[0]?.textContent || '';
      const formula = cell && children(cell, 'f')[0];
      const inline = cell && elements(cell, XLS, 't').map(node => node.textContent).join('');
      const readonly = protectedSheet || Boolean(formula) || type === 'e';
      if (formula) return { value: formula.textContent ? '=' + formula.textContent : value, readonly };
      return { value: type === 's' ? strings[Number(value)] ?? '' : type === 'inlineStr' ? inline : value, readonly };
    },
    write(rowNumber, columnNumber, value) {
      const ref = columnName(columnNumber) + rowNumber;
      let row = rows.get(rowNumber);
      let cell = cells.get(ref);
      if (!cell && !value) return;
      if (!row) {
        row = part.xml.createElementNS(XLS, 'row');
        row.setAttribute('r', rowNumber);
        sheet.insertBefore(row, children(sheet, 'row').find(item => Number(item.getAttribute('r')) > rowNumber) || null);
        rows.set(rowNumber, row);
      }
      if (!cell) {
        cell = part.xml.createElementNS(XLS, 'c');
        cell.setAttribute('r', ref);
        row.insertBefore(cell, children(row, 'c').find(item => columnIndex(item.getAttribute('r')) > columnNumber + 1) || null);
        cells.set(ref, cell);
      }
      for (const child of Array.from(cell.children)) {
        if (['v','is'].includes(child.localName)) child.remove();
      }
      cell.removeAttribute('t');
      if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[Ee][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value))) {
        const number = part.xml.createElementNS(XLS, 'v');
        number.textContent = value;
        cell.prepend(number);
      } else if (value !== '') {
        cell.setAttribute('t', 'inlineStr');
        const inline = part.xml.createElementNS(XLS, 'is');
        const text = part.xml.createElementNS(XLS, 't');
        text.setAttributeNS(XML, 'xml:space', 'preserve');
        text.textContent = value;
        inline.append(text);
        cell.prepend(inline);
      }
      elements(part.xml, XLS, 'dimension')[0]?.remove();
    },
  };
}
