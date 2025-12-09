const { jsPDF } = window.jspdf;

// Rate Limit Settings: 15 requests per minute = 4 seconds interval
const OCR_INTERVAL_MS = 4500;

async function init() {
    const statusEl = document.getElementById('status');
    const progressEl = document.getElementById('progressBar');
    const msgEl = document.getElementById('message');

    msgEl.textContent = "Loading data from storage...";

    try {
        // 1. Get Settings and Count
        const meta = await chrome.storage.local.get(['captureSettings', 'imageCount']);
        const settings = meta.captureSettings;
        const count = meta.imageCount || 0;

        if (!count || count === 0) {
            statusEl.textContent = "No images found.";
            return;
        }

        progressEl.max = count;
        msgEl.textContent = `Found ${count} pages. Generating...`;

        // Check for OCR need (future proofing if user enables it again)
        // Since UI was reverted, user might not have set ocrMode, but if they did earlier...
        const ocrMode = settings.ocrMode || 'off';
        const isOCR = (ocrMode !== 'off') && settings.apiKey;

        const transcripts = [];
        if (isOCR) {
            statusEl.textContent = "Starting OCR Processing...";
            msgEl.textContent = "Processing OCR (Slow mode)...";
            for (let i = 0; i < count; i++) {
                const imgKey = `img_${i}`;
                const res = await chrome.storage.local.get(imgKey);
                const imgData = res[imgKey];
                if (imgData) {
                    statusEl.textContent = `OCR ${i + 1}/${count}`;
                    progressEl.value = i + 1;
                    const response = await chrome.runtime.sendMessage({
                        action: 'PROCESS_OCR',
                        imageBase64: imgData,
                        apiKey: settings.apiKey
                    });
                    transcripts.push(response.text || "");
                    if (i < count - 1) await new Promise(r => setTimeout(r, OCR_INTERVAL_MS));
                }
            }
        }

        // Generate Output
        statusEl.textContent = "Generating Files...";
        progressEl.value = 0;

        if (settings.outputFormat === 'zip') {
            const zip = new JSZip();
            let fullMarkdown = "# Ocr Result\n\n";

            for (let i = 0; i < count; i++) {
                const imgKey = `img_${i}`;
                const res = await chrome.storage.local.get(imgKey);
                const imgData = res[imgKey];
                const baseName = String(i + 1).padStart(3, '0');

                if (imgData) {
                    const data = imgData.replace(/^data:image\/jpeg;base64,/, "");
                    zip.file(`${baseName}.jpg`, data, { base64: true });
                }
                if (isOCR) {
                    const txt = transcripts[i];
                    if (ocrMode === 'multi_md') zip.file(`${baseName}.md`, txt);
                    if (ocrMode === 'single_md') fullMarkdown += `## Page ${i + 1}\n\n${txt}\n\n---\n\n`;
                }
                progressEl.value = i + 1;
            }
            if (isOCR && ocrMode === 'single_md') zip.file("transcript.md", fullMarkdown);

            statusEl.textContent = "Saving ZIP...";
            const content = await zip.generateAsync({ type: "blob" });
            downloadFile(content, 'kindle_book.zip');

        } else {
            const doc = new jsPDF({
                orientation: 'landscape',
                unit: 'px',
                format: [window.screen.width, window.screen.height]
            });
            for (let i = 0; i < count; i++) {
                const imgKey = `img_${i}`;
                const res = await chrome.storage.local.get(imgKey);
                const imgData = res[imgKey];
                if (imgData) {
                    const img = new Image();
                    img.src = imgData;
                    await new Promise(r => img.onload = r);
                    if (i > 0) doc.addPage([img.width, img.height], img.width > img.height ? 'landscape' : 'portrait');
                    else { doc.deletePage(1); doc.addPage([img.width, img.height], img.width > img.height ? 'landscape' : 'portrait'); }
                    doc.addImage(imgData, 'JPEG', 0, 0, img.width, img.height);
                }
                progressEl.value = i + 1;
                statusEl.textContent = `Processing ${i + 1}/${count}`;
            }
            statusEl.textContent = "Saving PDF...";
            doc.save('kindle_book.pdf');
        }

        statusEl.textContent = "Done!";
        msgEl.textContent = "Download complete.";

    } catch (error) {
        console.error(error);
        statusEl.textContent = "Error!";
        msgEl.textContent = error.message;
    }
}

function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
}

init();
