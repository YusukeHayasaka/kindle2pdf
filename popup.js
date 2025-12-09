const { jsPDF } = window.jspdf;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadBtn = document.getElementById('downloadBtn');
const pageCountEl = document.getElementById('pageCount');

// Debug Logger
function log(msg) {
    console.log(msg);
    const box = document.getElementById('debugLog');
    if (box) {
        box.textContent += msg + '\n';
        box.scrollTop = box.scrollHeight;
    }
}

function getVal(id) {
    const el = document.getElementById(id);
    if (!el) {
        log(`Error: Element #${id} not found.`);
        return null;
    }
    return el.value;
}

// UI Loop to poll status from Background
async function pollStatus() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'GET_STATUS' });
        if (response) {
            if (response.isCapturing) {
                startBtn.style.display = 'none';
                stopBtn.style.display = 'block';
                downloadBtn.style.display = 'none';
                if (pageCountEl) pageCountEl.textContent = response.count;
                if (response.lastLog) log(`[BG] ${response.lastLog}`);
                setTimeout(pollStatus, 1000);
            } else {
                startBtn.style.display = 'block';
                stopBtn.style.display = 'none';
                if (response.count > 0) {
                    downloadBtn.style.display = 'block';
                    if (pageCountEl) pageCountEl.textContent = response.count;
                }
            }
        }
    } catch (e) {
        // Background might be sleeping or busy
        console.log("Poll error", e);
    }
}

function saveSettings() {
    chrome.storage.local.set({
        direction: getVal('direction'),
        bookType: getVal('bookType'),
        outputFormat: getVal('outputFormat')
    });
}
function loadSettings() {
    chrome.storage.local.get(['direction', 'bookType', 'outputFormat'], (res) => {
        if (res.direction) document.getElementById('direction').value = res.direction;
        if (res.bookType) document.getElementById('bookType').value = res.bookType;
        if (res.outputFormat) document.getElementById('outputFormat').value = res.outputFormat;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    pollStatus(); // Check if already running
    log("Popup v2.0.1 (Syntax Fixed)");
});

if (startBtn) startBtn.addEventListener('click', async () => {
    log("Start clicked.");
    saveSettings();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { alert("Kindle tab not found."); return; }

    const settings = {
        direction: getVal('direction'),
        outputFormat: getVal('outputFormat'),
        bookType: getVal('bookType'), // Added bookType to settings
        // ocrMode/apiKey logic was removed by user, so we ignore it here for now
        // If they add it back, we just read getVal('ocrMode') etc.
    };

    try {
        log("Sending Start Command to Background...");
        await chrome.runtime.sendMessage({
            action: 'START_CAPTURE',
            tabId: tab.id,
            windowId: tab.windowId,
            settings: settings
        });

        // Start polling UI
        pollStatus();

    } catch (e) {
        log("Failed to start: " + e.message);
        alert("開始に失敗: " + e.message);
    }
});

if (stopBtn) stopBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'STOP_CAPTURE' });
    pollStatus();
});

if (downloadBtn) downloadBtn.addEventListener('click', async () => {
    // If not capturing, ask background to open download page
    await chrome.runtime.sendMessage({ action: 'STOP_CAPTURE' });
});

['direction', 'bookType', 'outputFormat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveSettings);
});
