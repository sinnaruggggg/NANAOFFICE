import { zipSync } from 'fflate';
import { readXml, unzipDocument } from './ooxml.js';

const PARAGRAPH = 'http://www.hancom.co.kr/hwpml/2011/paragraph';

export function textDelta(before, after) {
  before = Array.from(before);
  after = Array.from(after);
  let start = 0;
  let tail = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (tail < before.length - start && tail < after.length - start &&
         before[before.length - tail - 1] === after[after.length - tail - 1]) tail++;
  return { start, end: before.length - tail, inserted: after.slice(start, after.length - tail).join('') };
}

export function patchableHwpx(bytes, count) {
  const files = unzipDocument(bytes);
  const parts = [];
  for (let section = 0; section < count; section++) {
    const path = 'Contents/section' + section + '.xml';
    if (!files[path]) return null;
    const xml = readXml(files, path);
    const paragraphs = Array.from(xml.documentElement.children).filter(node =>
      node.localName === 'p' && node.namespaceURI === PARAGRAPH);
    parts.push({path, xml, paragraphs});
  }

  const changed = new Set();
  function textNodes(paragraph) {
    if (!paragraph) return [];
    const runs = Array.from(paragraph.children).filter(node => node.localName === 'run');
    return runs.flatMap(run => Array.from(run.children).filter(node => node.localName === 't'));
  }

  return {
    canEdit(section, paragraph, expected) {
      const texts = textNodes(parts[section]?.paragraphs[paragraph]);
      return texts.length > 0 && texts.every(node => !node.childElementCount) &&
        texts.map(node => node.textContent).join('') === expected;
    },
    update(section, paragraph, before, after) {
      const part = parts[section];
      const texts = textNodes(part.paragraphs[paragraph]);
      const delta = textDelta(before, after);
      let offset = 0;
      let inserted = false;
      for (const node of texts) {
        const text = Array.from(node.textContent);
        const start = Math.min(text.length, Math.max(0, delta.start - offset));
        const end = Math.min(text.length, Math.max(0, delta.end - offset));
        const add = !inserted && offset + text.length >= delta.start;
        if (start !== end || add) {
          node.textContent = text.slice(0, start).join('') + (add ? delta.inserted : '') + text.slice(end).join('');
        }
        if (add) inserted = true;
        offset += text.length;
      }
      changed.add(part);
    },
    serialize() {
      const xmlWriter = new XMLSerializer();
      const utf8 = new TextEncoder();
      for (const part of changed) {
        files[part.path] = utf8.encode(xmlWriter.serializeToString(part.xml.documentElement));
      }
      const { mimetype, ...entries } = files;
      return zipSync(mimetype ? { mimetype:[mimetype, {level:0}], ...entries } : entries, {level:3});
    },
  };
}
