import { UserError } from './ui-messages.js';
import { zipSync } from 'fflate';
import { readXml, unzipDocument } from './ooxml.js';
import { textDelta } from './hwpx.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML = 'http://www.w3.org/XML/1998/namespace';
const PATH = 'word/document.xml';

export function openDocx(bytes) {
  const files = unzipDocument(bytes);
  const xml = readXml(files, PATH);
  const body = xml.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new UserError('지원하는 DOCX 본문을 찾을 수 없습니다.');
  const protectedDocument = files['word/settings.xml'] && Array.from(
    readXml(files,'word/settings.xml').getElementsByTagNameNS(W,'documentProtection'),
  ).some(item => ['on','true','1'].includes(item.getAttributeNS(W,'enforcement')));

  const paragraphs = Array.from(body.getElementsByTagNameNS(W, 'p'))
    .map(paragraph => Array.from(paragraph.getElementsByTagNameNS(W,'t'))
      .filter(node => nearestParagraph(node) === paragraph))
    .filter(nodes => nodes.length > 0);
  return {
    paragraphs,
    protectedDocument,
    update(nodes, before, after) {
      const {start,end,inserted} = textDelta(before, after);
      let offset = 0;
      let added = false;
      for (const node of nodes) {
        const text = Array.from(node.textContent);
        const left = Math.min(text.length, Math.max(0, start - offset));
        const right = Math.min(text.length, Math.max(0, end - offset));
        const add = !added && offset + text.length >= start;
        if (left !== right || add) {
          node.textContent = text.slice(0,left).join('') + (add ? inserted : '') + text.slice(right).join('');
          node.setAttributeNS(XML, 'xml:space', 'preserve');
        }
        added ||= add;
        offset += text.length;
      }
    },
    serialize() {
      files[PATH] = new TextEncoder().encode(new XMLSerializer().serializeToString(xml.documentElement));
      return zipSync(files,{level:3});
    },
  };
}

function nearestParagraph(node) {
  let item = node.parentElement;
  while (item && (item.localName !== 'p' || item.namespaceURI !== W)) item = item.parentElement;
  return item;
}
