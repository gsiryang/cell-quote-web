const state = { records: [], modelIndex: new Map(), sizeIndex: new Map(), rows: [] };
const $ = (selector) => document.querySelector(selector);
const els = {
  status: $("#dataStatus"), query: $("#queryInput"), body: $("#resultBody"), count: $("#resultCount"),
  customer: $("#customerInput"), date: $("#dateInput"), order: $("#orderInput"),
  delivery: $("#deliveryBtn"), pickup: $("#pickupBtn"), qty: $("#totalQty"), amount: $("#totalAmount"), toast: $("#toast")
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
    const response = await fetch("data/quotes.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.records = payload.records || [];
    for (const record of state.records) {
      state.modelIndex.set(record.key || normalize(record.model), record);
      const sizeKey = normalize(record.size);
      if (sizeKey && !state.sizeIndex.has(sizeKey)) state.sizeIndex.set(sizeKey, record);
    }
    const time = payload.generatedAt ? new Date(payload.generatedAt).toLocaleString("zh-CN", { hour12: false }) : "";
    els.status.textContent = `报价数据 ${state.records.length.toLocaleString()} 条${time ? ` · ${time}` : ""}`;
    els.status.className = "status-pill ready";
  } catch (error) {
    els.status.textContent = "报价数据读取失败";
    els.status.className = "status-pill error";
    showToast("无法读取报价数据，请通过本地服务器或 GitHub Pages 打开");
  }
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
  state.rows = queries.map((query, index) => {
    const record = findRecord(query);
    return record ? {
      id: `${Date.now()}-${index}`, query, model: record.model, size: record.size, appearance: record.appearance,
      capacity: record.capacity, basePrice: record.price, finalPrice: record.price, quantity: "", found: true
    } : { id: `${Date.now()}-${index}`, query, model: "未找到", size: "", appearance: "", capacity: "", basePrice: "", finalPrice: "", quantity: "", found: false };
  });
  render();
  const found = state.rows.filter((row) => row.found).length;
  showToast(`查询完成：找到 ${found} 条，未找到 ${state.rows.length - found} 条`);
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
  els.count.textContent = `${state.rows.length} 条`;
  updateSummary();
}

function updateSummary() {
  const valid = state.rows.filter((row) => row.found);
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
  const rows = documentRows();
  if (!rows.length) return;
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
  const rows = documentRows();
  if (!rows.length) return;
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

function downloadWorkbook(title, headers, rows) {
  const info = { customer: text(els.customer.value), date: els.date.value || today(), order: text(els.order.value) };
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

$("#queryBtn").addEventListener("click", runQuery);
$("#clearBtn").addEventListener("click", () => { els.query.value = ""; state.rows = []; render(); });
els.delivery.addEventListener("click", exportDelivery);
els.pickup.addEventListener("click", exportPickup);
els.query.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") runQuery(); });
els.date.value = today();
window.__quoteApp = { state, runQuery, buildXlsx, findRecord, exportDelivery, exportPickup };
const selfTestXlsx = buildXlsx("测试", ["电池", "MAH", "数量"], [["456495", "3200", 1]], { customer: "", date: today(), order: "" });
document.documentElement.dataset.xlsxCheck = `${selfTestXlsx[0]},${selfTestXlsx[1]},${selfTestXlsx[2]},${selfTestXlsx[3]}:${selfTestXlsx.length}`;
loadData();
