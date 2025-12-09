const { jsPDF } = window.jspdf;

let isCapturing = false;
let images = [];
const WAIT_TIME_MS = 1500;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadBtn = document.getElementById('downloadBtn');
const pageCountEl = document.getElementById('pageCount');

// Debug Logger
function log(msg) {
    console.log(msg);
    const box = document.getElementById('debugLog');
    if (box) {
        box.style.display = 'block';
        box.textContent += msg + '\n';
        box.scrollTop = box.scrollHeight;
    }
}

function setCapturingState(capturing) {
    isCapturing = capturing;
    if (capturing) {
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'block';
        if (downloadBtn) downloadBtn.style.display = 'none';
    } else {
        if (startBtn) startBtn.style.display = 'block';
        if (stopBtn) stopBtn.style.display = 'none';
        if (images.length > 0 && downloadBtn) {
            downloadBtn.style.display = 'block';
        }
    }
}

function getValue(id) {
    const el = document.getElementById(id);
    if (!el) {
        log("Error: Element not found: " + id);
        return null;
    }
    return el.value;
}

async function captureLoop() {
    if (!isCapturing) return;

    try {
        log("Capturing visible tab...");
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 90 });

        if (images.length > 0) {
            const lastImage = images[images.length - 1];
            if (dataUrl === lastImage) {
                log("Duplicate image detected. Assuming end of book.");
                setCapturingState(false);
                await generateAndSaveOutput();
                return;
            }
        }

        images.push(dataUrl);
        if (pageCountEl) pageCountEl.textContent = images.length;
        log(`Saved page ${images.length}`);

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            const direction = getValue('direction') || 'right';
            log(`Turning page (Direction: ${direction})...`);

            try {
                await chrome.tabs.sendMessage(tab.id, { action: "NEXT_PAGE", direction: direction });
            } catch (err) {
                log("Message failed: " + err.message);
                if (err.message.includes("receiving end does not exist") || err.message.includes("Could not establish connection")) {
                    log("Injecting content script...");
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['content.js']
                    });
                    await new Promise(r => setTimeout(r, 500)); // Wait for script
                    log("Retrying page turn...");
                    await chrome.tabs.sendMessage(tab.id, { action: "NEXT_PAGE", direction: direction });
                } else {
                    throw err;
                }
            }
        }

        if (isCapturing) {
            setTimeout(captureLoop, WAIT_TIME_MS);
        }

    } catch (error) {
        log("CRITICAL ERROR: " + error.message);
        console.error(error);
        alert('エラーが発生しました: ' + error.message);
        setCapturingState(false);
    }
}

async function generateAndSaveOutput() {
    log("Generating output...");
    if (images.length === 0) {
        log("No images to save.");
        return;
    }

    const outputFormat = getValue('outputFormat') || 'pdf';

    try {
        if (outputFormat === 'zip') {
            const zip = new JSZip();
            images.forEach((imgData, i) => {
                const base64Data = imgData.replace(/^data:image\/jpeg;base64,/, "");
                zip.file(`${String(i + 1).padStart(3, '0')}.jpg`, base64Data, { base64: true });
            });
            const content = await zip.generateAsync({ type: "blob" });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = 'kindle_book_images.zip';
            link.click();
        } else {
            const doc = new jsPDF({
                orientation: 'landscape',
                unit: 'px',
                format: [window.screen.width, window.screen.height]
            });

            for (let i = 0; i < images.length; i++) {
                const imgData = images[i];
                const img = new Image();
                img.src = imgData;
                await new Promise(r => img.onload = r);

                if (i > 0) {
                    doc.addPage([img.width, img.height], img.width > img.height ? 'landscape' : 'portrait');
                } else {
                    doc.deletePage(1);
                    doc.addPage([img.width, img.height], img.width > img.height ? 'landscape' : 'portrait');
                }
                doc.addImage(imgData, 'JPEG', 0, 0, img.width, img.height);
            }
            doc.save('kindle_book.pdf');
        }
        log("Download started.");
    } catch (e) {
        log("Save failed: " + e.message);
        alert("保存に失敗しました: " + e.message);
    }
}

function saveSettings() {
    chrome.storage.local.set({
        direction: getValue('direction'),
        bookType: getValue('bookType'),
        outputFormat: getValue('outputFormat')
    });
}

function loadSettings() {
    chrome.storage.local.get(['direction', 'bookType', 'outputFormat'], (result) => {
        const dirEl = document.getElementById('direction');
        const typeEl = document.getElementById('bookType');
        const fmtEl = document.getElementById('outputFormat');

        if (dirEl && result.direction) dirEl.value = result.direction;
        if (typeEl && result.bookType) typeEl.value = result.bookType;
        if (fmtEl && result.outputFormat) fmtEl.value = result.outputFormat;
    });
}

document.addEventListener('DOMContentLoaded', loadSettings);

if (startBtn) {
    startBtn.addEventListener('click', async () => {
        log("Starting capture...");
        images = [];
        if (pageCountEl) pageCountEl.textContent = '0';
        setCapturingState(true);
        saveSettings();

        // Window resize
        const bookType = getValue('bookType');
        const windowId = chrome.windows.WINDOW_ID_CURRENT;

        if (bookType === 'maximized') {
            await chrome.windows.update(windowId, { state: 'maximized' });
        } else if (bookType && bookType !== 'current') {
            let width = 1280; let height = 800;
            if (bookType === 'magazine') { width = 850; height = 1100; }
            else if (bookType === 'manga') { width = 750; height = 1000; }
            else if (bookType === 'spread') { width = 1400; height = 900; }

            await chrome.windows.update(windowId, { state: 'normal', width, height });
        }

        setTimeout(captureLoop, 1000);
    });
}

if (stopBtn) stopBtn.addEventListener('click', async () => {
    log("Stop requested.");
    setCapturingState(false);
    await generateAndSaveOutput();
});

if (downloadBtn) downloadBtn.addEventListener('click', generateAndSaveOutput);

['direction', 'bookType', 'outputFormat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveSettings);
});
