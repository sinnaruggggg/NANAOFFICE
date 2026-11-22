const encoder = new TextEncoder();
const BOM = '\uFEFF';

export function openText(bytes) {
  if (!bytes) return {value:'', prefix:'', eol:'\n'};
  let value;
  let prefix = '';
  if (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0xfe && bytes[1] === 0xff) {
    value = new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be', {fatal:true}).decode(bytes);
    prefix = BOM;
  } else {
    try { value = new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
    catch {
      value = new TextDecoder('euc-kr',{fatal:true}).decode(bytes);
      prefix = BOM;
    }
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) prefix = BOM;
  }
  if (value.includes('\0')) throw Error('이 텍스트 인코딩을 읽을 수 없습니다.');
  return { value, prefix, eol: value.includes('\r\n') ? '\r\n' : value.includes('\r') ? '\r' : '\n' };
}

export function encodeText(text, value) {
  return encoder.encode(text.prefix + value.replace(/\r\n?|\n/g, text.eol));
}

export function readTable(text, extension) {
  const delimiter = extension === 'tsv' ? '\t' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let fieldStart = true;
  let quotesClosed = false;
  let cells = 0;

  function addField() {
    if (++cells > 300000) throw Error('표의 셀이 너무 많습니다. 30만 셀 이하의 파일을 선택하세요.');
    row.push(field);
    field = '';
    fieldStart = true;
    quotesClosed = false;
  }
  function endRow() {
    addField();
    rows.push(row);
    row = [];
  }
  for (let i = 0; i < text.value.length; i++) {
    const char = text.value[i];
    if (quoted) {
      if (char === '"' && text.value[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; quotesClosed = true; }
      else field += char;
    } else if (char === delimiter) addField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text.value[i + 1] === '\n') i++;
      endRow();
    } else if (fieldStart && char === '"') {
      fieldStart = false;
      quoted = true;
    } else {
      if (quotesClosed) throw Error('표의 따옴표 사용 형식을 확인하세요.');
      fieldStart = false;
      field += char;
    }
  }
  if (quoted) throw Error('표에 닫는 따옴표가 빠져 있습니다.');
  const trailing = /[\r\n]$/.test(text.value);
  if (!trailing || !rows.length) endRow();
  return { rows, delimiter, trailing, text };
}

export function encodeTable(table) {
  const escape = value => value.includes(table.delimiter) || /["\r\n]/.test(value)
    ? '"' + value.replace(/"/g,'""') + '"' : value;
  const value = table.rows.map(row => row.map(escape).join(table.delimiter)).join(table.text.eol);
  return encodeText(table.text, value + (table.trailing ? table.text.eol : ''));
}
