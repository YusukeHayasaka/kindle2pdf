// Background Service Worker for Kindle to PDF

let isCapturing = false;
let targetTabId = null;
let targetWindowId = null;
let captureSettings = {};
let imageCount = 0;
let lastLog = "Ready.";
const WAIT_TIME_MS = 2000;

function bgLog(msg) {
    console.log(msg);
    lastLog = msg;
}

// Helper: Save image to storage
async function saveImageToStorage(dataUrl, index) {
    const key = `img_${index}`;
    await chrome.storage.local.set({ [key]: dataUrl });
}

// Helper: Clear storage
async function clearStorage() {
    await chrome.storage.local.clear();
}

// Helper: Resize Window
async function resizeWindow(windowId, bookType) {
    bgLog(`Resizing window ${windowId} for ${bookType}`);
    try {
        if (bookType === 'maximized') {
            await chrome.windows.update(windowId, { state: 'maximized' });
        } else if (bookType && bookType !== 'current') {
            let w = 1280, h = 800;
            if (bookType === 'magazine') { w = 850; h = 1100; }
            else if (bookType === 'manga') { w = 750; h = 1000; }
            else if (bookType === 'spread') { w = 1400; h = 900; }
            await chrome.windows.update(windowId, { state: 'normal', width: w, height: h });
        }
    } catch (e) {
        bgLog("Resize error: " + e.message);
    }
}

// Helper: Go to Start
async function goToStart(tabId) {
    bgLog("Moving to start page...");
    try {
        await chrome.tabs.sendMessage(tabId, { action: "GO_TO_START" });
    } catch (err) {
        bgLog("Injecting nav script...");
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });
        await new Promise(r => setTimeout(r, 1000));
        await chrome.tabs.sendMessage(tabId, { action: "GO_TO_START" });
    }
    // Wait for transition
    await new Promise(r => setTimeout(r, 3000));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_CAPTURE') {
        const { tabId, windowId, settings } = request;
        targetTabId = tabId;
        targetWindowId = windowId;
        captureSettings = settings;
        isCapturing = true;
        imageCount = 0;

        bgLog(`Started. Win:${windowId}`);

        // Execute sequence asynchronously so we can return response immediately
        (async () => {
            await clearStorage();
            await chrome.storage.local.set({ 'captureSettings': settings });

            // 1. Resize
            await resizeWindow(targetWindowId, settings.bookType);
            // Wait a bit for resize to settle
            await new Promise(r => setTimeout(r, 1000));

            // 2. Go to Start
            await goToStart(targetTabId);

            // 3. Start Capture Loop
            captureLoop();
        })();

        sendResponse({ status: 'started' });
        return true;

    } else if (request.action === 'STOP_CAPTURE') {
        isCapturing = false;
        bgLog("Stopping...");
        openDownloadPage();
        sendResponse({ status: 'stopped' });

    } else if (request.action === 'GET_STATUS') {
        sendResponse({
            isCapturing,
            count: imageCount,
            lastLog
        });

    } else if (request.action === 'PROCESS_OCR') {
        // OCR Stub - allow download page to use it later
        const { imageBase64, apiKey } = request;
        callGeminiAPI(imageBase64, apiKey).then(text => {
            sendResponse({ text: text });
        });
        return true;
    }
});

async function callGeminiAPI(base64Image, apiKey) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const cleanBase64 = base64Image.replace(/^data:image\/(jpeg|png);base64,/, "");
    const payload = {
        contents: [{
            parts: [
                { text: "Transcribe all text in this image. Output ONLY the transcribed text, preserving layout if possible. Do not add any conversational text." },
                { inline_data: { mime_type: "image/jpeg", data: cleanBase64 } }
            ]
        }]
    };
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(response.statusText);
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (e) {
        return `[OCR Error: ${e.message}]`;
    }
}

async function captureLoop() {
    if (!isCapturing) return;

    try {
        bgLog(`Capturing (Img: ${imageCount})...`);
        const dataUrl = await chrome.tabs.captureVisibleTab(targetWindowId, { format: 'jpeg', quality: 90 });

        // Duplicate Check
        if (imageCount > 0) {
            const lastIdx = imageCount - 1;
            const res = await chrome.storage.local.get(`img_${lastIdx}`);
            const lastImage = res[`img_${lastIdx}`];
            if (dataUrl === lastImage) {
                bgLog("Duplicate image detected. Stopping.");
                isCapturing = false;
                openDownloadPage();
                return;
            }
        }

        await saveImageToStorage(dataUrl, imageCount);
        imageCount++;
        await chrome.storage.local.set({ 'imageCount': imageCount });

        await tryTurnPage(targetTabId);

        if (isCapturing) {
            setTimeout(captureLoop, WAIT_TIME_MS);
        }

    } catch (error) {
        bgLog("Error: " + error.message);
        isCapturing = false;
        chrome.runtime.sendMessage({ action: 'ERROR', message: error.message }).catch(() => { });
    }
}

async function tryTurnPage(tabId) {
    const direction = captureSettings.direction || 'right';
    try {
        await chrome.tabs.sendMessage(tabId, { action: "NEXT_PAGE", direction: direction });
    } catch (err) {
        bgLog("Retry script inject...");
        await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] });
        await new Promise(r => setTimeout(r, 1000));
        await chrome.tabs.sendMessage(tabId, { action: "NEXT_PAGE", direction: direction });
    }
}

async function openDownloadPage() {
    bgLog("Opening download page...");
    await chrome.tabs.create({ url: 'download.html' });
}
