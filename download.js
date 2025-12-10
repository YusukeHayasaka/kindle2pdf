const { jsPDF } = window.jspdf;

// Rate Limit Settings: 500ms for paid tier
const OCR_INTERVAL_MS = 500;

async function init() {
    const statusEl = document.getElementById('status');
    const progressEl = document.getElementById('progressBar');
    const msgEl = document.getElementById('message');

    msgEl.textContent = "Loading data from storage...";

    try {
        // 1. Get Settings and Count
        const meta = await chrome.storage.local.get(['captureSettings', 'imageCount']);
        const settings = meta.captureSettings || {};
        const count = meta.imageCount || 0;

        if (!count || count === 0) {
            statusEl.textContent = "No images found.";
            return;
        }

        const appMode = settings.appMode || 'capture_only';
        const isOCR = (appMode === 'capture_ocr') && settings.apiKey;

        statusEl.textContent = "Generating Image File...";
        msgEl.textContent = "Preparing downloadable images...";
        progressEl.max = count;
        progressEl.value = 0;

        // --- Step 1: Always Generate and Download the Image Output (ZIP/PDF) first ---
        // This ensures the user gets their images even if OCR fails later.
        if (settings.outputFormat === 'zip') {
            const zip = new JSZip();
            for (let i = 0; i < count; i++) {
                const imgKey = `img_${i}`;
                const res = await chrome.storage.local.get(imgKey);
                const baseName = String(i + 1).padStart(3, '0');
                if (res[imgKey]) {
                    const data = res[imgKey].replace(/^data:image\/jpeg;base64,/, "");
                    zip.file(`${baseName}.jpg`, data, { base64: true });
                }
                progressEl.value = i + 1;
            }
            statusEl.textContent = "Saving Image ZIP...";
            const content = await zip.generateAsync({ type: "blob" });
            downloadFile(content, 'kindle_images.zip');

        } else {
            // PDF
            const doc = new jsPDF({
                orientation: 'landscape',
                unit: 'px',
                format: [window.screen.width, window.screen.height]
            });
            for (let i = 0; i < count; i++) {
                const imgKey = `img_${i}`;
                const res = await chrome.storage.local.get(imgKey);
                if (res[imgKey]) {
                    const img = new Image();
                    img.src = res[imgKey];
                    await new Promise(r => img.onload = r);
                    if (i > 0) doc.addPage([img.width, img.height], img.width > img.height ? 'landscape' : 'portrait');
                    else { doc.deletePage(1); doc.addPage([img.width, img.height], img.width > img.height ? 'landscape' : 'portrait'); }
                    doc.addImage(res[imgKey], 'JPEG', 0, 0, img.width, img.height);
                }
                progressEl.value = i + 1;
                statusEl.textContent = `PDF Gen ${i + 1}/${count}`;
            }
            statusEl.textContent = "Saving PDF...";
            doc.save('kindle_book.pdf');
        }

        // --- Step 2: If OCR Mode, start OCR processing ---
        if (isOCR) {
            // Confirmation Dialog
            // Note: We use setTimeout to allow the UI to render the "Saving..." state before Alert blocks it.
            // A slight delay ensures the previous download triggers and UI updates visually.
            await new Promise(r => setTimeout(r, 500));

            const doOCR = confirm("画像の保存が完了しました。\n続けて「文字起こし (OCR)」を開始しますか？\n\n※時間がかかる場合があります。");

            if (!doOCR) {
                statusEl.textContent = "OCR Cancelled";
                statusEl.style.color = "gray";
                msgEl.textContent = "OCR process was skipped by user.";
                return; // Stop here
            }

            statusEl.style.color = "blue";
            statusEl.textContent = "Starting OCR...";
            msgEl.textContent = `Using ${settings.geminiModel}. Please wait (Slow mode for API limits)...`;
            progressEl.value = 0;

            let combinedText = "";
            const isMarkdown = settings.ocrFormat === 'markdown';

            if (isMarkdown) combinedText += `# OCR Transcript\n\n`;

            for (let i = 0; i < count; i++) {
                statusEl.textContent = `OCR Processing: Page ${i + 1} / ${count}`;
                progressEl.value = i + 1;

                const imgKey = `img_${i}`;
                const res = await chrome.storage.local.get(imgKey);

                if (res[imgKey]) {
                    const response = await chrome.runtime.sendMessage({
                        action: 'PROCESS_OCR',
                        imgKey: imgKey,
                        apiKey: settings.apiKey,
                        model: settings.geminiModel
                    });

                    const text = response.text || "[No Text Found]";

                    if (isMarkdown) {
                        combinedText += `## Page ${i + 1}\n\n${text}\n\n`;
                    } else {
                        combinedText += `[Page ${i + 1}]\n${text}\n\n`;
                    }

                    // Rate Limiting
                    if (i < count - 1) {
                        await new Promise(r => setTimeout(r, OCR_INTERVAL_MS));
                    }
                }
            }

            statusEl.textContent = "Saving OCR Result...";

            // Get title from storage
            const meta2 = await chrome.storage.local.get(['bookTitle']);
            let filename = meta2.bookTitle || "kindle_book";
            // Sanitize filename
            filename = filename.replace(/[<>:"/\\|?*]+/g, '_').trim();
            if (!filename) filename = "kindle_book";

            const ext = isMarkdown ? "md" : "txt";
            const blob = new Blob([combinedText], { type: isMarkdown ? "text/markdown" : "text/plain" });
            downloadFile(blob, `${filename}.${ext}`);
        }

        statusEl.textContent = "All Done!";
        statusEl.style.color = "green";
        msgEl.textContent = "Process complete.";

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
