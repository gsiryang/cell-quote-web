/* Local OCR for model lists. Only engine/language assets are downloaded. */
(function () {
  "use strict";

  function cleanLines(value) {
    return String(value).normalize("NFKC").split(/\r?\n/)
      .map((line) => line.replace(/[|│┃]/g, " ").replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim())
      .filter((line) => /[a-z0-9]/i.test(line));
  }

  function appendLines(current, lines) {
    const key = (line) => line.replace(/\s+/g, "").toLowerCase();
    const seen = new Set(String(current).split(/\r?\n/).map(key));
    const added = lines.filter((line) => {
      if (seen.has(key(line))) return false;
      seen.add(key(line));
      return true;
    });
    return { value: added.length ? [current.trimEnd(), ...added].filter(Boolean).join("\n") : current, count: added.length };
  }

  // Remove only near-continuous full-width/full-height ruling lines, not glyph strokes.
  function removeTableLines(data, width, height) {
    const horizontal = new Uint8Array(height);
    const vertical = new Uint8Array(width);
    const dark = (offset) => data[offset] + data[offset + 1] + data[offset + 2] < 420 && data[offset + 3] > 128;
    for (let y = 0; y < height; y++) {
      let count = 0;
      for (let x = 0; x < width; x++) if (dark((y * width + x) * 4)) count++;
      if (count > width * 0.78) horizontal[y] = 1;
    }
    for (let x = 0; x < width; x++) {
      let count = 0;
      for (let y = 0; y < height; y++) if (dark((y * width + x) * 4)) count++;
      if (count > height * 0.78) vertical[x] = 1;
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (horizontal[y] || horizontal[y - 1] || horizontal[y + 1] || vertical[x] || vertical[x - 1] || vertical[x + 1]) {
          const offset = (y * width + x) * 4;
          data[offset] = data[offset + 1] = data[offset + 2] = data[offset + 3] = 255;
        }
      }
    }
    return data;
  }

  function preparePixels(source, width, height) {
    const factor = Math.min(2, 2400 / Math.max(width, height));
    const scaledWidth = Math.round(width * factor);
    const scaledHeight = Math.round(height * factor);
    const outputWidth = scaledWidth + 40;
    const outputHeight = scaledHeight + 40;
    const data = new Uint8ClampedArray(outputWidth * outputHeight * 4).fill(255);
    // Bilinear enlargement and a black/white pass help small screenshot text.
    for (let y = 0; y < scaledHeight; y++) {
      for (let x = 0; x < scaledWidth; x++) {
        const sx = Math.max(0, (x + 0.5) / factor - 0.5);
        const sy = Math.max(0, (y + 0.5) / factor - 0.5);
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
        const dx = sx - x0, dy = sy - y0;
        let sum = 0;
        for (let channel = 0; channel < 3; channel++) {
          sum += Math.round(
            source[(y0 * width + x0) * 4 + channel] * (1 - dx) * (1 - dy)
            + source[(y0 * width + x1) * 4 + channel] * dx * (1 - dy)
            + source[(y1 * width + x0) * 4 + channel] * (1 - dx) * dy
            + source[(y1 * width + x1) * 4 + channel] * dx * dy);
        }
        const offset = ((y + 20) * outputWidth + x + 20) * 4;
        data[offset] = data[offset + 1] = data[offset + 2] = sum / 3 < 128 ? 0 : 255;
      }
    }
    return { data, width: outputWidth, height: outputHeight };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { cleanLines, appendLines, removeTableLines, preparePixels };
    return;
  }

  const query = document.querySelector("#queryInput");
  const button = document.querySelector("#ocrImageBtn");
  const pasteButton = document.querySelector("#ocrPasteBtn");
  const picker = document.querySelector("#ocrImageInput");
  const status = document.querySelector("#ocrStatus");
  let busy = false;
  let readingClipboard = false;
  let enginePromise;
  let queryRevision = 0;
  // A clear action must not be undone when an in-flight recognition finishes.
  document.querySelector("#clearBtn").addEventListener("click", () => { queryRevision++; });

  function loadEngine() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (enginePromise) return enginePromise;
    enginePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = setTimeout(() => fail(), 30000);
      function fail() {
        clearTimeout(timer);
        script.remove();
        reject(new Error("识别组件加载失败，请检查网络后重试"));
      }
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js";
      script.onload = () => { clearTimeout(timer); window.Tesseract ? resolve(window.Tesseract) : fail(); };
      script.onerror = fail;
      document.head.appendChild(script);
    }).catch((error) => { enginePromise = null; throw error; });
    return enginePromise;
  }

  async function prepareImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("图片无法读取，请改用 PNG 或 JPG 图片"));
        image.src = url;
      });
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height || width * height > 40000000) throw new Error("图片尺寸过大或无效，请裁剪到型号所在区域再试");
      const scale = Math.min(1, 2400 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      removeTableLines(pixels.data, canvas.width, canvas.height);
      const prepared = preparePixels(pixels.data, canvas.width, canvas.height);
      const enlarged = document.createElement("canvas");
      enlarged.width = prepared.width;
      enlarged.height = prepared.height;
      const output = enlarged.getContext("2d");
      output.putImageData(new ImageData(prepared.data, prepared.width, prepared.height), 0, 0);
      return enlarged;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function recognizeImage(file) {
    if (busy) return;
    if (!file || !/^image\/(png|jpeg|webp|bmp)$/i.test(file.type)) {
      status.textContent = "请选择 PNG、JPG、WebP 或 BMP 图片。";
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      status.textContent = "图片超过 15 MB，请裁剪到型号所在区域后重试。";
      return;
    }
    busy = true;
    button.disabled = true;
    pasteButton.disabled = true;
    button.textContent = "正在识别…";
    status.setAttribute("aria-busy", "true");
    status.textContent = "正在准备图片和识别组件，首次加载可能需要一些时间…";
    const revision = queryRevision;
    let worker;
    let expired = false;
    let timer;
    try {
      const result = await Promise.race([
        (async () => {
          const image = await prepareImage(file);
          const engine = await loadEngine();
          if (expired) throw new Error("识别已超时");
          worker = await engine.createWorker("eng", 1, {
            workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js",
            corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0",
            logger: (message) => {
              if (!expired && message.status === "recognizing text") status.textContent = `正在识别文字… ${Math.round(message.progress * 100)}%`;
            }
          });
          if (expired) { await worker.terminate(); throw new Error("识别已超时"); }
          await worker.setParameters({ tessedit_pageseg_mode: "6", user_defined_dpi: "300" });
          return worker.recognize(image);
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => { expired = true; reject(new Error("识别超时，请检查网络或裁剪图片后重试")); }, 90000);
        })
      ]);
      const lines = cleanLines(result.data.text);
      if (!lines.length) throw new Error("未识别到型号，请使用清晰、正向的型号列表截图");
      if (revision !== queryRevision) {
        status.textContent = "查询框已清空，本次识别结果未填入。可重新选择图片识别。";
        return;
      }
      const merged = appendLines(query.value, lines);
      query.value = merged.value;
      query.dispatchEvent(new Event("input", { bubbles: true }));
      status.textContent = `识别到 ${lines.length} 行，已追加 ${merged.count} 行（重复项已跳过）。请核对字母与数字，尤其是 O/0、S/5，再点击“开始查询”。`;
    } catch (error) {
      status.textContent = `${error.message || "识别失败，请检查网络和图片后重试"}。原有输入已保留。`;
    } finally {
      expired = true;
      clearTimeout(timer);
      if (worker) await worker.terminate().catch(() => {});
      busy = false;
      button.disabled = false;
      pasteButton.disabled = readingClipboard;
      button.textContent = "图片识别填入";
      status.setAttribute("aria-busy", "false");
      picker.value = "";
    }
  }

  button.addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => { if (picker.files[0]) recognizeImage(picker.files[0]); });
  pasteButton.addEventListener("click", async () => {
    if (busy || readingClipboard) return;
    if (!navigator.clipboard?.read || !window.isSecureContext) {
      status.textContent = "当前浏览器无法通过按钮读取图片。请点击查询框后按 Ctrl+V（Mac：⌘V），或长按查询框选择粘贴。";
      query.focus();
      return;
    }
    readingClipboard = true;
    pasteButton.disabled = true;
    const revision = queryRevision;
    try {
      const items = await navigator.clipboard.read();
      if (busy || revision !== queryRevision) return;
      for (const item of items) {
        const type = item.types.find((value) => /^image\/(png|jpeg|webp|bmp)$/i.test(value));
        if (!type) continue;
        const image = await item.getType(type);
        if (!busy && revision === queryRevision) await recognizeImage(image);
        return;
      }
      status.textContent = "剪贴板中没有可识别的图片。请先截图或右键选择“复制图片”，再粘贴；复制图片地址或文件路径无法识别。";
    } catch {
      if (!busy) {
        status.textContent = "未能读取剪贴板。请允许浏览器读取，或点击查询框后按 Ctrl+V（Mac：⌘V）粘贴截图。";
        query.focus();
      }
    } finally {
      readingClipboard = false;
      pasteButton.disabled = busy;
    }
  });

  document.addEventListener("paste", (event) => {
    if (document.querySelector("#queryView").hidden || event.defaultPrevented) return;
    // Preserve ordinary pasting in customer, price and other editable fields.
    const editable = event.target.closest?.("input, textarea, [contenteditable]:not([contenteditable='false'])");
    if (editable && editable !== query) return;
    const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type.startsWith("image/"));
    const file = item?.getAsFile() || Array.from(event.clipboardData?.files || []).find((entry) => entry.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    if (busy) return;
    return recognizeImage(file);
  });
})();
