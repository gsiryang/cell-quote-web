const state = { records: [], modelIndex: new Map(), sizeIndex: new Map(), rows: [], counterRows: [] };
const $ = (selector) => document.querySelector(selector);
const els = {
  status: $("#dataStatus"), query: $("#queryInput"), body: $("#resultBody"), count: $("#resultCount"),
  customer: $("#customerInput"), date: $("#dateInput"), order: $("#orderInput"),
  delivery: $("#deliveryBtn"), pickup: $("#pickupBtn"), qty: $("#totalQty"), amount: $("#totalAmount"), toast: $("#toast"),
  counterFile: $("#counterFile"), counterFileName: $("#counterFileName"), counterStatus: $("#counterStatus"),
  counterBody: $("#counterBody"), counterCount: $("#counterCount"), counterPickup: $("#counterPickupBtn"),
  counterCustomer: $("#counterCustomer"), counterDate: $("#counterDate")
};

const normalize = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();
const text = (value) => String(value ?? "").trim();
const xml = (value) => text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const number = (value) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
const optionalNumber = (value) => {
  const raw = String(value ?? "").replace(/,/g, "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2300);
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function loadData() {
  try {
    const response = await fetch("data/网页报价数据.xlsx", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await parseFirstWorksheet(await response.arrayBuffer());
    state.records = quoteRecordsFromRows(rows);
    state.modelIndex.clear();
    state.sizeIndex.clear();
    for (const record of state.records) {
      state.modelIndex.set(record.key || normalize(record.model), record);
      const sizeKey = normalize(record.size);
      if (sizeKey && !state.sizeIndex.has(sizeKey)) state.sizeIndex.set(sizeKey, record);
    }
    els.status.textContent = `报价数据 ${state.records.length.toLocaleString()} 条 · Excel 已载入`;
    els.status.className = "status-pill ready";
  } catch (error) {
    els.status.textContent = "报价数据读取失败";
    els.status.className = "status-pill error";
    showToast("无法读取报价数据，请通过本地服务器或 GitHub Pages 打开");
  }
}

function quoteRecordsFromRows(rows) {
  const headerRowIndex = rows.slice(0, 20).findIndex((row) => row.map(headerKey).includes("电池型号"));
  if (headerRowIndex < 0) throw new Error("报价 Excel 缺少“电池型号”标题");
  const headers = rows[headerRowIndex];
  const modelIndex = findColumn(headers, ["电池型号"]);
  const sizeIndex = findColumn(headers, ["电芯尺寸"]);
  const appearanceIndex = findColumn(headers, ["外观"]);
  const capacityIndex = findColumn(headers, ["容量", "MAH"]);
  const priceIndex = findColumn(headers, ["单价"]);
  return rows.slice(headerRowIndex + 1).map((row) => ({
    model: text(row[modelIndex]), key: normalize(row[modelIndex]),
    size: sizeIndex >= 0 ? text(row[sizeIndex]) : "",
    appearance: appearanceIndex >= 0 ? text(row[appearanceIndex]) : "",
    capacity: capacityIndex >= 0 ? text(row[capacityIndex]) : "",
    price: priceIndex >= 0 ? text(row[priceIndex]) : ""
  })).filter((record) => record.model);
}

function findRecord(query) {
  const key = normalize(query);
  if (!key) return null;
  if (state.modelIndex.has(key) && text(state.modelIndex.get(key).size)) return state.modelIndex.get(key);
  if (state.sizeIndex.has(key)) return state.sizeIndex.get(key);
  if (state.modelIndex.has(key)) return state.modelIndex.get(key);
  const candidates = state.records.filter((record) => record.key.includes(key) || key.includes(record.key));
  return candidates.length === 1 ? candidates[0] : null;
}

function runQuery() {
  const queries = [...new Set(els.query.value.split(/\r?\n/).map(text).filter(Boolean))];
  if (!queries.length) return showToast("请先输入要查询的型号或尺寸");
  state.rows = groupQueryMatches(queries.map((query) => ({ query, record: findRecord(query) })));
  render();
  const foundModels = state.rows.filter((row) => row.found).reduce((sum, row) => sum + row.models.length, 0);
  const missing = state.rows.filter((row) => !row.found).length;
  showToast(`查询完成：找到 ${foundModels} 个型号，合并为 ${state.rows.filter((row) => row.found).length} 行，未找到 ${missing} 个`);
}

function uniqueJoined(records, field) {
  return [...new Set(records.map((record) => text(record[field])).filter(Boolean))].join("/");
}

function groupQueryMatches(matches) {
  const result = [], groupIndexes = new Map();
  for (const { query, record } of matches) {
    if (!record) {
      result.push({
        id: `query-${Date.now()}-${result.length}`, query, queries: [query], model: "未找到", models: [],
        size: "", appearance: "", capacity: "", basePrice: "", finalPrice: "", quantity: "", found: false
      });
      continue;
    }
    const groupKey = record.size ? `size:${normalize(record.size)}` : `model:${normalize(record.model)}`;
    if (!groupIndexes.has(groupKey)) {
      const row = {
        id: `query-${Date.now()}-${result.length}`, query, queries: [query], model: record.model, models: [record.model],
        records: [record], size: record.size, appearance: record.appearance, capacity: record.capacity,
        basePrice: record.price, finalPrice: record.price, quantity: "", found: true
      };
      groupIndexes.set(groupKey, result.length);
      result.push(row);
      continue;
    }
    const row = result[groupIndexes.get(groupKey)];
    if (!row.queries.includes(query)) row.queries.push(query);
    if (!row.models.includes(record.model)) row.models.push(record.model);
    row.records.push(record);
    row.query = row.queries.join("/");
    row.model = row.models.join("/");
    row.appearance = uniqueJoined(row.records, "appearance");
    row.capacity = uniqueJoined(row.records, "capacity");
    row.basePrice = uniqueJoined(row.records, "price");
    row.finalPrice = row.basePrice;
  }
  return result;
}

function expandModelRows(rows) {
  return rows.filter((row) => row.found).flatMap((row) => {
    const models = row.models?.length ? row.models : [row.model];
    return models.map((model) => ({ ...row, model, query: model, models: [model] }));
  });
}

function render() {
  if (!state.rows.length) {
    els.body.innerHTML = '<tr class="empty-row"><td colspan="9">输入型号后开始查询</td></tr>';
  } else {
    els.body.innerHTML = state.rows.map((row) => `<tr data-id="${row.id}">
      <td>${xml(row.query)}</td><td class="${row.found ? "" : "not-found"}">${xml(row.model)}</td>
      <td>${xml(row.size)}</td><td>${xml(row.appearance)}</td><td><input class="capacity-input" data-field="capacity" value="${xml(row.capacity)}" placeholder="填写容量" ${row.found ? "" : "disabled"}></td><td>${xml(row.basePrice)}</td>
      <td><input class="price-input" data-field="finalPrice" value="${xml(row.finalPrice)}" ${row.found ? "" : "disabled"}></td>
      <td><input inputmode="decimal" data-field="quantity" value="${xml(row.quantity)}" placeholder="0" ${row.found ? "" : "disabled"}></td>
      <td><button class="remove-btn" data-action="remove" title="移除">删除</button></td></tr>`).join("");
  }
  const modelCount = state.rows.filter((row) => row.found).reduce((sum, row) => sum + row.models.length, 0);
  els.count.textContent = `${state.rows.length} 行 · ${modelCount} 个型号`;
  updateSummary();
}

function updateSummary() {
  const valid = expandModelRows(state.rows);
  const qty = valid.reduce((sum, row) => sum + number(row.quantity), 0);
  const amount = valid.reduce((sum, row) => {
    const price = optionalNumber(row.finalPrice);
    return sum + (price === null ? 0 : number(row.quantity) * price);
  }, 0);
  els.qty.textContent = qty.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  els.amount.textContent = `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  els.delivery.disabled = els.pickup.disabled = !valid.length;
}

els.body.addEventListener("input", (event) => {
  const rowElement = event.target.closest("tr[data-id]");
  if (!rowElement || !event.target.dataset.field) return;
  const row = state.rows.find((item) => item.id === rowElement.dataset.id);
  if (row) row[event.target.dataset.field] = event.target.value;
  updateSummary();
});
els.body.addEventListener("click", (event) => {
  if (event.target.dataset.action !== "remove") return;
  const rowElement = event.target.closest("tr[data-id]");
  state.rows = state.rows.filter((row) => row.id !== rowElement.dataset.id);
  render();
});

function documentRows() {
  const rows = state.rows.filter((row) => row.found);
  if (!rows.length) showToast("没有可生成单据的查询结果");
  return rows;
}

function exportDelivery() {
  const groupedRows = documentRows();
  if (!groupedRows.length) return;
  const rows = expandModelRows(groupedRows);
  const values = rows.map((row) => {
    const price = optionalNumber(row.finalPrice);
    const quantity = optionalNumber(row.quantity);
    return [row.model, row.size, row.appearance, row.capacity, price === null ? text(row.finalPrice) : price, quantity === null ? text(row.quantity) : quantity, price === null || quantity === null ? "" : price * quantity];
  });
  const hasQuantity = rows.some((row) => optionalNumber(row.quantity) !== null);
  const hasAmount = rows.some((row) => optionalNumber(row.quantity) !== null && optionalNumber(row.finalPrice) !== null);
  values.push(["", "", "", "", "合计", hasQuantity ? rows.reduce((sum, row) => sum + number(row.quantity), 0) : "", hasAmount ? rows.reduce((sum, row) => {
    const price = optionalNumber(row.finalPrice);
    return sum + (price === null ? 0 : price * number(row.quantity));
  }, 0) : ""]);
  downloadWorkbook("送货单", ["电池型号", "电芯尺寸", "外观", "MAH", "单价", "数量", "金额"], values);
}

function exportPickup() {
  const groupedRows = documentRows();
  if (!groupedRows.length) return;
  const rows = expandModelRows(groupedRows);
  const grouped = new Map();
  for (const row of rows) {
    const battery = row.size || row.model;
    const key = `${normalize(battery)}\u0000${text(row.capacity)}`;
    if (!grouped.has(key)) grouped.set(key, { battery, capacity: row.capacity, quantity: text(row.quantity) });
    else grouped.get(key).quantity = mergeQuantity(grouped.get(key).quantity, row.quantity);
  }
  const values = [...grouped.values()].map((item) => [item.battery, item.capacity, item.quantity]);
  downloadWorkbook("取货单", ["电池", "MAH", "数量"], values);
}

function mergeQuantity(current, additional) {
  const left = text(current), right = text(additional);
  if (!left) return right;
  if (!right) return left;
  const leftNumber = optionalNumber(left), rightNumber = optionalNumber(right);
  return leftNumber !== null && rightNumber !== null ? leftNumber + rightNumber : `${left}+${right}`;
}

function downloadWorkbook(title, headers, rows, infoOverride=null) {
  const info = infoOverride || { customer: text(els.customer.value), date: els.date.value || today(), order: text(els.order.value) };
  const bytes = buildXlsx(title, headers, rows, info);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const prefix = info.customer ? `${safeFilename(info.customer)}_` : "";
  anchor.href = url;
  anchor.download = `${prefix}${info.date.replace(/-/g, "")}_${title}.xlsx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`${title}已生成`);
}

const safeFilename = (value) => value.replace(/[\\/:*?"<>|]/g, "_");

function buildXlsx(title, headers, rows, info) {
  const columnCount = headers.length;
  const sheetRows = [
    [{ value: title, style: 1 }],
    ["客户名称", info.customer, "日期", info.date, "单号", info.order],
    [],
    headers.map((value) => ({ value, style: 2 })),
    ...rows.map((row) => row.map((value, index) => ({ value, style: typeof value === "number" && index >= columnCount - 3 ? 3 : 0 })))
  ];
  const rowXml = sheetRows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((item, columnIndex) => cellXml(item, columnIndex, rowIndex + 1)).join("")}</row>`).join("");
  const endColumn = columnName(columnCount - 1);
  const widths = Array.from({ length: columnCount }, (_, index) => `<col min="${index + 1}" max="${index + 1}" width="${index === 0 ? 22 : index === columnCount - 1 ? 14 : 16}" customWidth="1"/>`).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rowXml}</sheetData><mergeCells count="1"><mergeCell ref="A1:${endColumn}1"/></mergeCells></worksheet>`;
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(title)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="18"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B6BCB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": sheet
  };
  return zipStore(files);
}

function cellXml(item, columnIndex, rowIndex) {
  const object = item && typeof item === "object" && !Array.isArray(item) ? item : { value: item, style: 0 };
  const reference = `${columnName(columnIndex)}${rowIndex}`;
  const style = object.style ? ` s="${object.style}"` : "";
  if (typeof object.value === "number" && Number.isFinite(object.value)) return `<c r="${reference}"${style}><v>${object.value}</v></c>`;
  return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(object.value)}</t></is></c>`;
}

function columnName(index) {
  let result = "";
  for (index += 1; index; index = Math.floor((index - 1) / 26)) result = String.fromCharCode(65 + ((index - 1) % 26)) + result;
  return result;
}

const encoder = new TextEncoder();
const crcTable = (() => Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }))();
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function u16(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255); }
function u32(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
function concat(parts) { const size = parts.reduce((sum, part) => sum + part.length, 0); const output = new Uint8Array(size); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; }
function zipStore(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = encoder.encode(name), data = typeof value === "string" ? encoder.encode(value) : value, crc = crc32(data);
    const local = concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data]);
    const central = concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const centralData = concat(centrals);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(centrals.length), u16(centrals.length), u32(centralData.length), u32(offset), u16(0)]);
  return concat([...locals, centralData, end]);
}

async function unzipXlsx(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer), view = new DataView(arrayBuffer);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) {
    if (view.getUint32(index, true) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error("文件不是有效的 .xlsx 工作簿");
  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const files = new Map();
  for (let entry = 0; entry < entryCount; entry++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Excel 压缩目录损坏");
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let content;
    if (method === 0) content = compressed;
    else if (method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("当前浏览器版本过旧，无法解析压缩 Excel");
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      content = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error(`暂不支持 Excel 压缩方式 ${method}`);
    files.set(name.replace(/\\/g, "/"), content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function excelColumnIndex(reference) {
  const letters = String(reference || "").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

async function parseFirstWorksheet(fileOrBuffer) {
  const arrayBuffer = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer();
  const files = await unzipXlsx(arrayBuffer);
  const decoder = new TextDecoder("utf-8");
  const shared = [];
  if (files.has("xl/sharedStrings.xml")) {
    const document = new DOMParser().parseFromString(decoder.decode(files.get("xl/sharedStrings.xml")), "application/xml");
    for (const item of document.querySelectorAll("si")) shared.push(item.textContent || "");
  }
  const sheetName = [...files.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort()[0];
  if (!sheetName) throw new Error("Excel 中没有可读取的工作表");
  const sheet = new DOMParser().parseFromString(decoder.decode(files.get(sheetName)), "application/xml");
  const rows = [];
  for (const rowNode of sheet.querySelectorAll("sheetData row")) {
    const row = [];
    for (const cell of rowNode.querySelectorAll("c")) {
      const column = excelColumnIndex(cell.getAttribute("r"));
      const type = cell.getAttribute("t");
      const raw = cell.querySelector("v")?.textContent ?? cell.querySelector("is")?.textContent ?? "";
      row[column] = type === "s" ? (shared[Number(raw)] ?? "") : raw;
    }
    rows.push(row.map((value) => text(value)));
  }
  return rows;
}

const headerKey = (value) => normalize(value).replace(/[（）()]/g, "");
function findColumn(headers, aliases) {
  const keys = headers.map(headerKey);
  return aliases.map(headerKey).map((alias) => keys.indexOf(alias)).find((index) => index >= 0) ?? -1;
}

function aggregateCounterRows(rows) {
  const headerRowIndex = rows.slice(0, 20).findIndex((row) => {
    const keys = row.map(headerKey);
    return keys.includes("数量") && (keys.includes("mah") || keys.includes("容量"));
  });
  if (headerRowIndex < 0) throw new Error("找不到标题行：必须包含“数量”和“MAH/容量”");
  const headers = rows[headerRowIndex];
  const modelIndex = findColumn(headers, ["电池型号", "查询内容", "电池", "手机型号"]);
  const sizeIndex = findColumn(headers, ["电芯尺寸", "仓库尺寸", "尺寸"]);
  const capacityIndex = findColumn(headers, ["MAH", "容量", "电芯容量"]);
  const quantityIndex = findColumn(headers, ["数量", "订购数量", "取货数量"]);
  if (modelIndex < 0 && sizeIndex < 0) throw new Error("请提供“电芯尺寸”或“电池型号/查询内容”标题");
  if (capacityIndex < 0 || quantityIndex < 0) throw new Error("请提供“MAH/容量”和“数量”标题");

  const grouped = new Map();
  for (const row of rows.slice(headerRowIndex + 1)) {
    const model = modelIndex >= 0 ? text(row[modelIndex]) : "";
    const size = sizeIndex >= 0 ? text(row[sizeIndex]) : "";
    const battery = size || model;
    const capacity = text(row[capacityIndex]);
    const quantity = text(row[quantityIndex]);
    if (!battery) continue;
    const groupType = size ? "size" : "model";
    const key = `${groupType}\u0000${normalize(battery)}\u0000${capacity}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `counter-${grouped.size}`, battery, capacity, quantity,
        models: new Set(size && model ? [model] : [])
      });
    } else {
      grouped.get(key).quantity = mergeQuantity(grouped.get(key).quantity, quantity);
      if (size && model) grouped.get(key).models.add(model);
    }
  }
  if (!grouped.size) throw new Error("Excel 中没有可用的出货明细");
  return [...grouped.values()].map((row) => ({
    id: row.id,
    battery: row.battery,
    capacity: row.capacity,
    quantity: row.quantity,
    remark: [...row.models].join("/")
  }));
}

function renderCounter() {
  if (!state.counterRows.length) {
    els.counterBody.innerHTML = '<tr class="empty-row"><td colspan="5">导入 Excel 后显示汇总结果</td></tr>';
  } else {
    els.counterBody.innerHTML = state.counterRows.map((row) => `<tr data-counter-id="${row.id}">
      <td><input data-counter-field="battery" value="${xml(row.battery)}"></td>
      <td><input data-counter-field="capacity" value="${xml(row.capacity)}"></td>
      <td><input data-counter-field="quantity" value="${xml(row.quantity)}"></td>
      <td><input data-counter-field="remark" value="${xml(row.remark)}" placeholder="电池型号备注"></td>
      <td><button class="remove-btn" data-counter-action="remove">删除</button></td></tr>`).join("");
  }
  els.counterCount.textContent = `${state.counterRows.length} 条`;
  els.counterPickup.disabled = !state.counterRows.length;
}

async function importCounterFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    els.counterFile.value = "";
    return showToast("目前支持 .xlsx 文件，请先另存为 xlsx");
  }
  els.counterFileName.textContent = file.name;
  els.counterStatus.textContent = "正在读取并汇总…";
  try {
    const rows = await parseFirstWorksheet(file);
    state.counterRows = aggregateCounterRows(rows);
    renderCounter();
    els.counterStatus.textContent = `读取 ${Math.max(0, rows.length - 1)} 行，汇总为 ${state.counterRows.length} 条取货记录`;
    showToast("出货数量计算完成");
  } catch (error) {
    state.counterRows = [];
    renderCounter();
    els.counterStatus.textContent = error.message;
    showToast(`导入失败：${error.message}`);
  }
}

function exportCounterPickup() {
  if (!state.counterRows.length) return showToast("请先导入出货 Excel");
  const values = state.counterRows.map((row) => [row.battery, row.capacity, optionalNumber(row.quantity) ?? row.quantity, row.remark]);
  downloadWorkbook("取货单", ["电池", "MAH", "数量", "备注"], values, {
    customer: text(els.counterCustomer.value), date: els.counterDate.value || today(), order: ""
  });
}

function clearCounter() {
  state.counterRows = [];
  els.counterFile.value = "";
  els.counterFileName.textContent = "尚未选择文件";
  els.counterStatus.textContent = "请导入包含出货明细的 Excel 文件";
  renderCounter();
}

function switchView(viewId) {
  for (const view of document.querySelectorAll(".app-view")) view.hidden = view.id !== viewId;
  for (const item of document.querySelectorAll(".nav-item")) item.classList.toggle("active", item.dataset.view === viewId);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#queryBtn").addEventListener("click", runQuery);
$("#clearBtn").addEventListener("click", () => { els.query.value = ""; state.rows = []; render(); });
els.delivery.addEventListener("click", exportDelivery);
els.pickup.addEventListener("click", exportPickup);
els.query.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") runQuery(); });
els.counterFile.addEventListener("change", () => importCounterFile(els.counterFile.files[0]));
els.counterPickup.addEventListener("click", exportCounterPickup);
$("#counterClearBtn").addEventListener("click", clearCounter);
els.counterBody.addEventListener("input", (event) => {
  const rowElement = event.target.closest("tr[data-counter-id]");
  if (!rowElement || !event.target.dataset.counterField) return;
  const row = state.counterRows.find((item) => item.id === rowElement.dataset.counterId);
  if (row) row[event.target.dataset.counterField] = event.target.value;
});
els.counterBody.addEventListener("click", (event) => {
  if (event.target.dataset.counterAction !== "remove") return;
  const rowElement = event.target.closest("tr[data-counter-id]");
  state.counterRows = state.counterRows.filter((row) => row.id !== rowElement.dataset.counterId);
  renderCounter();
});
for (const navItem of document.querySelectorAll(".nav-item")) navItem.addEventListener("click", () => switchView(navItem.dataset.view));
els.date.value = today();
els.counterDate.value = today();
window.__quoteApp = {
  state, runQuery, buildXlsx, findRecord, exportDelivery, exportPickup,
  parseFirstWorksheet, aggregateCounterRows, groupQueryMatches, expandModelRows
};
const selfTestXlsx = buildXlsx("测试", ["电池", "MAH", "数量"], [["456495", "3200", 1]], { customer: "", date: today(), order: "" });
document.documentElement.dataset.xlsxCheck = `${selfTestXlsx[0]},${selfTestXlsx[1]},${selfTestXlsx[2]},${selfTestXlsx[3]}:${selfTestXlsx.length}`;
if (new URLSearchParams(location.search).has("selftest")) {
  const queryGroupTest = groupQueryMatches([
    { query: "SPARK5", record: { model: "SPARK5", size: "456495", appearance: "+", capacity: "3200", price: "52" } },
    { query: "CAMON15", record: { model: "CAMON15", size: "456495", appearance: "+", capacity: "3200", price: "52" } }
  ]);
  const queryExpandTest = expandModelRows(queryGroupTest);
  document.documentElement.dataset.queryGroupCheck =
    `${queryGroupTest.length}:${queryGroupTest[0].model}:${queryExpandTest.map((row) => row.model).join(",")}`;
  const aggregateTest = aggregateCounterRows([
    ["电池型号", "电芯尺寸", "MAH", "数量"],
    ["49FT", "456494", "3200", "10"],
    ["49IT", "456494", "3200", "20"],
    ["iPhone 15", "", "3300", "2"],
    ["iPhone 15", "", "3300", "3"]
  ]);
  document.documentElement.dataset.aggregateCheck = aggregateTest.map((row) => `${row.battery}:${row.capacity}:${row.quantity}:${row.remark}`).join("|");
  fetch("data/网页报价数据.xlsx", { cache: "no-store" }).then((response) => response.arrayBuffer()).then(parseFirstWorksheet).then((rows) => {
    document.documentElement.dataset.importCheck = rows[0]?.slice(0, 5).join("|") || "empty";
  }).catch((error) => { document.documentElement.dataset.importCheck = `error:${error.message}`; });
}
loadData();
