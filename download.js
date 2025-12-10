const { jsPDF } = window.jspdf;

// Rate Limit Settings: 500ms for paid tier
const OCR_INTERVAL_MS = 500;

async function init() {
    const statusEl = document.getElementById('status');
    const progressEl = document.getElementById('progressBar');
    const msgEl = document.getElementById('message');

    msgEl.textContent = "ストレージからデータを読み込み中...";

    try {
        // 1. Get Settings and Count
        const meta = await chrome.storage.local.get(['captureSettings', 'imageCount']);
        const settings = meta.captureSettings || {};
        const count = meta.imageCount || 0;

        if (!count || count === 0) {
            statusEl.textContent = "画像が見つかりません";
            return;
        }

        const appMode = settings.appMode || 'capture_only';
        const isOCR = (appMode === 'capture_ocr') && settings.apiKey;

        statusEl.textContent = "画像ファイルを生成中...";
        msgEl.textContent = "ダウンロード用の画像を準備中...";
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
            statusEl.textContent = "ZIPファイルを保存中...";
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
                statusEl.textContent = `PDF生成中 ${i + 1}/${count}`;
            }
            statusEl.textContent = "PDFを保存中...";
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
                statusEl.textContent = "OCRキャンセル";
                statusEl.style.color = "gray";
                msgEl.textContent = "OCR処理はユーザーによりスキップされました";
                return; // Stop here
            }

            statusEl.style.color = "blue";
            statusEl.textContent = "OCR開始中...";
            msgEl.textContent = `${settings.geminiModel} を使用中。しばらくお待ちください...`;
            progressEl.value = 0;

            let combinedText = "";
            const isMarkdown = settings.ocrFormat === 'markdown';

            if (isMarkdown) combinedText += `# OCR 文字起こし\n\n`;

            for (let i = 0; i < count; i++) {
                statusEl.textContent = `OCR処理中: ${i + 1} / ${count} ページ`;
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

                    const text = response.text || "[テキストが見つかりません]";

                    if (isMarkdown) {
                        combinedText += `## ${i + 1} ページ\n\n${text}\n\n`;
                    } else {
                        combinedText += `[${i + 1} ページ]\n${text}\n\n`;
                    }

                    // Rate Limiting
                    if (i < count - 1) {
                        await new Promise(r => setTimeout(r, OCR_INTERVAL_MS));
                    }
                }
            }

            statusEl.textContent = "OCR結果を保存中...";

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

        statusEl.textContent = "完了！";
        statusEl.style.color = "green";
        msgEl.textContent = "処理が完了しました";

    } catch (error) {
        console.error(error);
        statusEl.textContent = "エラー！";
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
