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

// Helper: Clear storage (Session data only)
async function clearStorage() {
    const items = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(items).filter(key =>
        key.startsWith('img_') ||
        ['imageCount', 'bookTitle', 'totalPages', 'captureSettings'].includes(key)
    );
    await chrome.storage.local.remove(keysToRemove);
}

// Helper: Resize Window
async function resizeWindow(windowId, settings) {
    bgLog(`Resizing window ${windowId} for ${settings.bookType}`);
    try {
        if (settings.bookType === 'maximized') {
            await chrome.windows.update(windowId, { state: 'maximized' });
        } else {
            // Determine dimensions
            // Previously calculated here, now strictly passed from popup or ignored
            const { width, height, bookType } = settings;

            if (bookType === 'maximized') {
                await chrome.windows.update(windowId, { state: 'maximized' });
            } else if (width && height) {
                // Enforce user-defined or preset dimensions
                await chrome.windows.update(windowId, {
                    state: 'normal',
                    width: parseInt(width),
                    height: parseInt(height)
                });
            } else {
                // current or undefined, do nothing
            }
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

            // 3. Get Metadata (Title & Total Pages)
            let totalPages = 0;
            let bookTitle = "kindle_book";
            try {
                // Wait a moment for UI to settle
                await new Promise(r => setTimeout(r, 1000));
                const metadata = await chrome.tabs.sendMessage(targetTabId, { action: 'GET_METADATA' });
                if (metadata) {
                    if (metadata.totalPages) totalPages = metadata.totalPages;
                    if (metadata.bookTitle) bookTitle = metadata.bookTitle;
                    bgLog(`Metadata: ${bookTitle} (${totalPages} pages)`);
                }
            } catch (e) {
                bgLog("Metadata scan failed: " + e.message);
            }

            // 4. Start Capture Loop
            // Store metadata so download.js can use it
            await chrome.storage.local.set({
                'bookTitle': bookTitle,
                'totalPages': totalPages
            });

            captureLoop();
        })();

        sendResponse({ status: 'started' });
        return true;

    } else if (request.action === 'STOP_CAPTURE') {
        isCapturing = false;
        bgLog("Stopping...");

        // If user manually stops, DISABLE OCR for this session
        openDownloadPage();
        sendResponse({ status: 'stopped' });
        return false;

    } else if (request.action === 'GET_STATUS') {
        // Check storage to ensure count is accurate even if SW restarted
        chrome.storage.local.get(['imageCount', 'lastActivity', 'totalPages']).then(res => {
            let storedCount = res.imageCount || 0;
            const lastActivity = res.lastActivity || 0;
            const total = res.totalPages || 0;
            const now = Date.now();

            // If data is older than 30 minutes, consider it stale and don't show it on initial screen
            if (now - lastActivity > 30 * 60 * 1000) {
                storedCount = 0;
            }

            // distinct logic: if persistent data exists and we are not capturing, show it.
            const displayCount = (isCapturing) ? imageCount : (storedCount > imageCount ? storedCount : imageCount);

            sendResponse({
                isCapturing,
                count: displayCount,
                sessionCount: imageCount, // Explicitly send session count for UI logic
                total: total,
                lastLog
            });
        });
        return true; // Async response

    } else if (request.action === 'PROCESS_OCR') {
        const { imgKey, apiKey, model } = request;

        chrome.storage.local.get(imgKey).then(res => {
            const imageBase64 = res[imgKey];
            if (!imageBase64) {
                sendResponse({ text: "[Error: Image not found in storage]" });
                return;
            }

            callGeminiAPI(imageBase64, apiKey, model)
                .then(text => {
                    sendResponse({ text: text });
                })
                .catch(err => {
                    console.error("OCR Logic Error:", err);
                    sendResponse({ text: `[System Error: ${err.message}]` });
                });
        }).catch(err => {
            console.error("Storage Get Error:", err);
            sendResponse({ text: `[Storage Error: ${err.message}]` });
        });

        return true;
    }
});

// Cost pricing per 1M tokens (USD)
const MODEL_PRICING = {
    'gemini-2.0-flash': { input: 0.10, output: 0.40 },
    'gemini-2.5-flash': { input: 0.15, output: 0.60 },
    'gemini-2.5-pro': { input: 1.25, output: 5.00 }
};

const USD_TO_JPY = 150; // Exchange rate

async function trackApiCost(model, usageMetadata) {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING['gemini-2.5-flash'];
    const inputTokens = usageMetadata.promptTokenCount || 0;
    const outputTokens = usageMetadata.candidatesTokenCount || 0;

    // Calculate cost in USD
    const costUSD = (inputTokens * pricing.input / 1000000) + (outputTokens * pricing.output / 1000000);
    const costJPY = costUSD * USD_TO_JPY;

    // Get stored cumulative usage
    const stored = await chrome.storage.local.get(['totalUsage']);
    let totalUsage = stored.totalUsage || 0;

    // Add current cost
    totalUsage += costJPY;

    // Save
    await chrome.storage.local.set({ totalUsage: totalUsage });

    bgLog(`Cost: ¥${costJPY.toFixed(4)} (累計: ¥${totalUsage.toFixed(2)})`);
}

async function callGeminiAPI(base64Image, apiKey, model = 'gemini-2.5-flash') {
    if (!apiKey) return "[OCR Error: Missing API Key]";

    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const cleanBase64 = base64Image.replace(/^data:image\/(jpeg|png);base64,/, "");

    // Load Prompt and Format Settings
    const res = await chrome.storage.local.get(['customPrompt', 'ocrFormat']);
    const defaultPrompt = `Transcribe all text in this image (Japanese/English). 
Output ONLY the transcribed text.
Rules:
1. Preserve original layout (paragraphs, line breaks) as much as possible.
2. EXCLUDE all headers and footers (e.g. "Page 10 of 200", "Location 300", Book Titles repeated on top/bottom).
3. EXCLUDE Kindle UI text such as "Learning Reading Speed", "X% left", etc.
4. Do not perform any conversation. Do not say "Here is the transcription". Just output the text content.`;

    let userPrompt = res.customPrompt || defaultPrompt;

    // Add Markdown instruction if format is markdown
    if (res.ocrFormat === 'markdown') {
        userPrompt += `\n5. Format the output in Markdown. Use appropriate headers (##, ###), bold (**text**), italic (*text*), and lists where applicable.`;
    }

    const payload = {
        contents: [{
            parts: [
                { text: userPrompt },
                { inline_data: { mime_type: "image/jpeg", data: cleanBase64 } }
            ]
        }]
    };

    // Timeout of 30 seconds
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            let errorMsg = response.statusText;
            try {
                const errorBody = await response.json();
                if (errorBody.error && errorBody.error.message) {
                    errorMsg = `${response.status} - ${errorBody.error.message}`;
                } else {
                    errorMsg = `${response.status} - ${JSON.stringify(errorBody)}`;
                }
            } catch (jsonErr) {
                // If text body
                const textBody = await response.text();
                errorMsg = `${response.status} - ${textBody}`;
            }
            throw new Error(errorMsg);
        }

        const data = await response.json();

        // Track cost from usageMetadata
        if (data.usageMetadata) {
            await trackApiCost(model, data.usageMetadata);
        }

        return data.candidates?.[0]?.content?.parts?.[0]?.text || "[No Text Found]";
    } catch (e) {
        console.error("Gemini API Error Detail:", e);
        let msg = "Unknown Error";
        if (e instanceof Error) {
            msg = e.message;
            if (!msg) msg = e.toString();
        } else if (typeof e === 'object') {
            try {
                msg = JSON.stringify(e);
            } catch (err) {
                msg = "Recursive Object";
            }
        } else {
            msg = String(e);
        }

        if (!msg || msg.trim() === "") msg = "Empty Error Message (Check Background Console)";

        return `[OCR-FAIL: ${msg}]`;
    }
}

async function captureLoop() {
    if (!isCapturing) return;

    try {
        // --- 1. Wait for Visual Stability by comparing screenshots ---
        // First, wait for page transition to begin
        bgLog("Waiting for page transition to start...");
        await new Promise(r => setTimeout(r, 500));  // Wait 500ms for transition to begin

        bgLog("Checking for visual stability...");
        let previousCapture = null;
        let stableCount = 0;
        const requiredStable = 3;  // Need 3 identical consecutive captures
        const maxAttempts = 50;    // Max 50 attempts (about 10 seconds)
        let attempts = 0;

        while (isCapturing && stableCount < requiredStable && attempts < maxAttempts) {
            attempts++;
            const currentCapture = await chrome.tabs.captureVisibleTab(targetWindowId, { format: 'jpeg', quality: 50 });

            if (previousCapture && currentCapture === previousCapture) {
                stableCount++;
                bgLog(`Visual stable check ${stableCount}/${requiredStable}`);
            } else {
                stableCount = 0;
                bgLog(`Visual change detected, attempt ${attempts}/${maxAttempts}`);
            }

            previousCapture = currentCapture;
            await new Promise(r => setTimeout(r, 1000));  // 1秒間隔でチェック
        }

        if (stableCount >= requiredStable) {
            bgLog("Visual stability confirmed.");
        } else {
            bgLog("Visual stability timeout, proceeding anyway.");
        }

        // --- 2. Capture (high quality) ---
        bgLog(`Capturing (Img: ${imageCount})...`);
        const dataUrl = await chrome.tabs.captureVisibleTab(targetWindowId, { format: 'jpeg', quality: 90 });

        // Duplicate Check
        if (imageCount > 0) {
            const lastIdx = imageCount - 1;
            const res = await chrome.storage.local.get(`img_${lastIdx}`);
            const lastImage = res[`img_${lastIdx}`];

            if (dataUrl === lastImage) {
                if (captureLoop.retryCount < 2) {
                    captureLoop.retryCount = (captureLoop.retryCount || 0) + 1;
                    bgLog(`Duplicate detected (Retry ${captureLoop.retryCount}/2). Re-sending turn signal...`);

                    // Force retry turn
                    await tryTurnPage(targetTabId);
                    await new Promise(r => setTimeout(r, 1500)); // Wait longer

                    // Restart loop for this index
                    setTimeout(captureLoop, 100);
                    return;
                } else {
                    bgLog("Duplicate persisted after retries. Stopping (End of Book?).");
                    isCapturing = false;
                    openDownloadPage();
                    return;
                }
            }
        }

        // Reset retry count on success
        captureLoop.retryCount = 0;

        await saveImageToStorage(dataUrl, imageCount);
        imageCount++;
        await chrome.storage.local.set({
            'imageCount': imageCount,
            'lastActivity': Date.now()
        });

        // --- 3. Next Page ---
        await tryTurnPage(targetTabId);

        if (isCapturing) {
            // Short loop delay since we now have smart wait
            setTimeout(captureLoop, 100);
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
    // Ensure capture is fully stopped
    isCapturing = false;
    targetTabId = null;
    targetWindowId = null;

    // Small delay to ensure any pending capture loop iteration completes
    await new Promise(r => setTimeout(r, 500));

    bgLog("Opening download page...");
    await chrome.tabs.create({ url: 'download.html' });
}
