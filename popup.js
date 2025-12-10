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
        // Trim whitespace if it's only whitespace (initial HTML garbage)
        if (!box.hasAttribute('data-initialized')) {
            box.textContent = '';
            box.setAttribute('data-initialized', 'true');
        }
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

let lastBgLog = "";
let wasDlVisible = false;

// UI Loop to poll status from Background
async function pollStatus() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'GET_STATUS' });
        if (response) {
            const pageCountEl = document.getElementById('pageCount');

            // Update Main Status Text
            if (response.isCapturing) {
                // IS CAPTURING
                startBtn.style.display = 'none';
                stopBtn.style.display = 'block';

                let statusText = `📸 キャプチャ中... (${response.count}`;
                if (response.total > 0) {
                    statusText += `/${response.total}ページ)`;
                } else {
                    statusText += `ページ)`;
                }
                if (pageCountEl) {
                    pageCountEl.textContent = statusText;
                    pageCountEl.style.color = "#0071e3"; // Active color
                }
            } else {
                // NOT CAPTURING
                startBtn.style.display = 'block';
                stopBtn.style.display = 'none';

                if (pageCountEl) {
                    pageCountEl.textContent = "✅ 準備完了";
                    pageCountEl.style.color = "#333";
                }
            }

            // Download Button Logic
            const dlContainer = document.getElementById('downloadContainer');
            let isDlVisible = false;

            // Hide container during capture
            if (response.isCapturing) {
                if (dlContainer) dlContainer.style.display = 'none';
                else if (downloadBtn) downloadBtn.style.display = 'none';
                isDlVisible = false;
            } else {
                if (response.sessionCount > 0) {
                    if (dlContainer) dlContainer.style.display = 'block';
                    else if (downloadBtn) downloadBtn.style.display = 'block';
                    isDlVisible = true;
                } else {
                    if (dlContainer) dlContainer.style.display = 'none';
                    else if (downloadBtn) downloadBtn.style.display = 'none';
                    isDlVisible = false;
                }
            }

            // Force Resize if visibility changed
            if (isDlVisible !== wasDlVisible) {
                wasDlVisible = isDlVisible;
                // Tiny width toggle to force Chrome to recalc height
                document.body.style.width = '351px';
                requestAnimationFrame(() => {
                    document.body.style.width = '350px';
                });
            }

            if (response.lastLog && response.lastLog !== lastBgLog) {
                lastBgLog = response.lastLog;
                log(`${response.lastLog}`);
            }
            setTimeout(pollStatus, 1000);
        }
    } catch (e) {
        // Background might be sleeping or busy
        console.log("Poll error", e);
    }
}

let isSettingsLoaded = false;

function saveSettings() {
    if (!isSettingsLoaded) return; // Prevent overwriting with defaults/empty before load

    const settings = {
        direction: getVal('direction'),
        bookType: getVal('bookType'),
        outputFormat: getVal('outputFormat'),
        appMode: getVal('appMode'),
        geminiModel: getVal('geminiModel'),
        ocrFormat: getVal('ocrFormat'),
        apiKey: getVal('apiKey'),
        costLimit: parseInt(getVal('costLimit')) || 0
    };
    chrome.storage.local.set(settings);
}

function loadSettings() {
    chrome.storage.local.get(['direction', 'bookType', 'outputFormat', 'appMode', 'geminiModel', 'ocrFormat', 'apiKey', 'costLimit', 'totalUsage'], (res) => {
        if (res.direction) document.getElementById('direction').value = res.direction;

        // For bookType, check if the option exists (presets may not be loaded yet)
        if (res.bookType) {
            const bookTypeEl = document.getElementById('bookType');
            const optionExists = Array.from(bookTypeEl.options).some(opt => opt.value === res.bookType);
            if (optionExists) {
                bookTypeEl.value = res.bookType;
            }
        }

        if (res.outputFormat) document.getElementById('outputFormat').value = res.outputFormat;
        if (res.appMode) {
            document.getElementById('appMode').value = res.appMode;
            // Sync ocrModeToggle checkbox
            const ocrToggle = document.getElementById('ocrModeToggle');
            if (ocrToggle) ocrToggle.checked = res.appMode === 'capture_ocr';
        }
        if (res.geminiModel) document.getElementById('geminiModel').value = res.geminiModel;
        if (res.ocrFormat) document.getElementById('ocrFormat').value = res.ocrFormat;
        if (res.apiKey) document.getElementById('apiKey').value = res.apiKey;
        if (res.costLimit) document.getElementById('costLimit').value = res.costLimit;

        // Display current monthly usage
        const usageEl = document.getElementById('currentMonthlyUsage');
        if (usageEl) {
            const usage = res.totalUsage || 0;
            usageEl.textContent = `¥${usage.toFixed(2)}`;
        }

        isSettingsLoaded = true;
        validateStartCondition();
    });
}

// Update cost display on main page
async function updateCostDisplay() {
    const data = await chrome.storage.local.get(['totalUsage', 'costLimit']);
    let usage = data.totalUsage || 0;
    let limit = data.costLimit || 0;

    // Update main page cost display (new design with separate elements)
    const usageEl = document.getElementById('mainCostUsage');
    const limitEl = document.getElementById('mainCostLimit');

    if (usageEl) {
        usageEl.textContent = `¥${usage.toFixed(0)}`;
    }
    if (limitEl) {
        limitEl.textContent = limit > 0 ? `¥${limit}` : '無制限';
    }

    // Update settings page display
    const settingsDisplay = document.getElementById('currentMonthlyUsage');
    if (settingsDisplay) {
        settingsDisplay.textContent = `¥${usage.toFixed(2)}`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    loadPrompt(); // Load prompt settings
    pollStatus(); // Check if already running
    updateCostDisplay(); // Update cost display

    // Sync ocrModeToggle checkbox with appMode select
    const ocrToggle = document.getElementById('ocrModeToggle');
    const appModeSelect = document.getElementById('appMode');

    if (ocrToggle && appModeSelect) {
        // Set initial state
        ocrToggle.checked = appModeSelect.value === 'capture_ocr';

        // Handle toggle change
        ocrToggle.addEventListener('change', () => {
            appModeSelect.value = ocrToggle.checked ? 'capture_ocr' : 'capture_only';
            saveSettings();
            validateStartCondition();
            updateCostDisplay();
        });
    }
});

// Reset cost button handler
const resetCostBtn = document.getElementById('resetCostBtn');
if (resetCostBtn) {
    resetCostBtn.addEventListener('click', async () => {
        if (confirm('累計コストをリセットしますか？')) {
            await chrome.storage.local.set({ totalUsage: 0 });
            updateCostDisplay();
            log('コストをリセットしました');
        }
    });
}

// Old Start logic removed, see bottom for new logic

if (stopBtn) stopBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'STOP_CAPTURE' });
    pollStatus();
});

// Settings Toggle Logic
// Settings Navigation
// --- UI Navigation ---
const openOptionsBtn = document.getElementById('openOptionsBtn');
const backBtn = document.getElementById('backBtn');
const settingsView = document.getElementById('settingsView');

openOptionsBtn.addEventListener('click', () => {
    // Prepare for animation
    settingsView.style.display = 'block';
    // Allow reflow
    requestAnimationFrame(() => {
        document.body.classList.add('settings-active');
    });
});

backBtn.addEventListener('click', () => {
    document.body.classList.remove('settings-active');
    // Wait for transition to finish before hiding
    setTimeout(() => {
        settingsView.style.display = 'none';
    }, 300);

    // Reload settings to reflect changes made in settings view
    loadSettings();
    updateCostDisplay();
    validateStartCondition();
});


// Prompt Settings Logic
const customPromptEl = document.getElementById('customPrompt');
const savePromptBtn = document.getElementById('savePromptBtn');
const resetPromptBtn = document.getElementById('resetPromptBtn');
const settingsMsg = document.getElementById('settingsMsg');

const defaultPrompt = `Transcribe all text in this image (Japanese/English). 
Output ONLY the transcribed text.
Rules:
1. Preserve original layout (paragraphs, line breaks) as much as possible.
2. EXCLUDE all headers and footers (e.g. "Page 10 of 200", "Location 300", Book Titles repeated on top/bottom).
3. EXCLUDE Kindle UI text such as "Learning Reading Speed", "X% left", etc.
4. Do not perform any conversation. Do not say "Here is the transcription". Just output the text content.`;

function loadPrompt() {
    chrome.storage.local.get(['customPrompt'], (res) => {
        customPromptEl.value = res.customPrompt || defaultPrompt;
    });
}

if (savePromptBtn) {
    savePromptBtn.addEventListener('click', () => {
        const val = customPromptEl.value;
        chrome.storage.local.set({ customPrompt: val }, () => {
            settingsMsg.textContent = "保存しました";
            setTimeout(() => { settingsMsg.textContent = ""; }, 2000);
        });
    });
}

if (resetPromptBtn) {
    resetPromptBtn.addEventListener('click', () => {
        if (confirm("プロンプトを初期値に戻しますか？")) {
            customPromptEl.value = defaultPrompt;
            chrome.storage.local.set({ customPrompt: defaultPrompt }, () => {
                settingsMsg.textContent = "リセットしました";
                setTimeout(() => { settingsMsg.textContent = ""; }, 2000);
            });
        }
    });
}

// Ensure prompt is loaded on init (hook into loadSettings or just run it)
// We'll call loadPrompt() inside the existing DOMContentLoaded listener logic or add it here.
// Let's add it to the init sequence below.


// OCR Mode UI Toggle (No longer needed for Settings Page visibility, but maybe good to notify user)
// In this Slide-in design, we show all settings in the "Detailed Settings".
// The 'appMode' selector remains in the Main View.

const appModeEl = document.getElementById('appMode');

if (appModeEl) {
    appModeEl.addEventListener('change', () => {
        saveSettings();
    });
}

if (downloadBtn) downloadBtn.addEventListener('click', async () => {
    // If not capturing, ask background to open download page
    await chrome.runtime.sendMessage({ action: 'STOP_CAPTURE' });
});

const goToSettingsFromWarningBtn = document.getElementById('goToSettingsFromWarningBtn');
const apiKeyWarning = document.getElementById('apiKeyWarning');

if (goToSettingsFromWarningBtn) {
    goToSettingsFromWarningBtn.addEventListener('click', () => {
        settingsView.style.display = 'block';
        requestAnimationFrame(() => {
            document.body.classList.add('settings-active');
        });

        // Optional: scroll to API key section
        setTimeout(() => {
            const el = document.getElementById('ocrSettings');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 300);
    });
}

function validateStartCondition() {
    const mode = document.getElementById('appMode').value;
    const key = document.getElementById('apiKey').value.trim();
    const costCard = document.getElementById('costDisplayCard');

    // Show/hide cost card based on OCR mode
    if (costCard) {
        costCard.style.display = mode === 'capture_ocr' ? 'block' : 'none';
    }

    if (mode === 'capture_ocr' && !key) {
        // Show Warning, Disable Start
        if (apiKeyWarning) apiKeyWarning.style.display = 'flex';
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.style.opacity = '0.5';
            startBtn.style.cursor = 'not-allowed';
        }
    } else {
        // Hide Warning, Enable Start (if not capturing)
        if (apiKeyWarning) apiKeyWarning.style.display = 'none';
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.style.opacity = '1';
            startBtn.style.cursor = 'pointer';
        }
    }
}

// Hook validation into logic
const settingsIds = ['direction', 'outputFormat', 'appMode', 'geminiModel', 'ocrFormat'];
settingsIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('change', () => {
            saveSettings();
            validateStartCondition(); // Check on change
        });
    }
});

// Save API Key immediately on input
const apiKeyEl = document.getElementById('apiKey');
if (apiKeyEl) {
    apiKeyEl.addEventListener('input', () => {
        saveSettings();
        validateStartCondition();
    });
    apiKeyEl.addEventListener('change', () => {
        saveSettings();
        validateStartCondition();
    });
}

// Save Cost Limit on change
const costLimitEl = document.getElementById('costLimit');
if (costLimitEl) {
    costLimitEl.addEventListener('change', () => {
        saveSettings();
    });
}

// --- Custom Window Size Presets Logic ---
const bookTypeEl = document.getElementById('bookType');
const toggleSizeParamsBtn = document.getElementById('toggleSizeParams');
const sizeParamsDiv = document.getElementById('sizeParams');
const customNameEl = document.getElementById('customName');
const customWidthEl = document.getElementById('customWidth');
const customHeightEl = document.getElementById('customHeight');
const addPresetBtn = document.getElementById('addPresetBtn');
const deletePresetBtn = document.getElementById('deletePresetBtn');

// Toggle Panel
// Toggle Panel (Removed in slide-in UI)

// Ensure presets are loaded and rendered
async function loadPresets() {
    try {
        const res = await chrome.storage.local.get(['windowPresets']);
        let presets = res.windowPresets;

        // 1. Initialize Defaults if first run or empty
        if (!presets || presets.length === 0) {
            const defaults = [
                { id: 'tablet', name: 'iPad / タブレット', width: 1000, height: 1333 },
                { id: 'kindle', name: 'Kindle端末 / スマホ', width: 750, height: 1100 },
                { id: 'wide', name: 'PC / 見開き', width: 1600, height: 1000 }
            ];
            await chrome.storage.local.set({ 'windowPresets': defaults });
            // Recursive call to reload with defaults
            return loadPresets();
        }

        // 2. Render Options
        // Clear existing options (except first 'current')
        Array.from(bookTypeEl.options).forEach(opt => {
            if (opt.value !== 'current') {
                opt.remove();
            }
        });

        // Add presets from storage
        presets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} (${p.width}x${p.height})`;
            opt.dataset.width = p.width;
            opt.dataset.height = p.height;
            bookTypeEl.appendChild(opt);
        });

        // Add "Create New" option
        const createOpt = document.createElement('option');
        createOpt.value = 'create_new';
        createOpt.textContent = '＋ 新しい設定を追加...';
        bookTypeEl.appendChild(createOpt);

        // 2. Update Settings View List
        const listContainer = document.getElementById('presetListContainer');
        if (listContainer) {
            listContainer.innerHTML = '';
            if (presets.length === 0) {
                listContainer.innerHTML = '<div style="font-size: 12px; color: #999; text-align: center;">(プリセットなし)</div>';
            } else {
                presets.forEach(p => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; background: #f9f9f9; padding: 8px; border-radius: 4px; border: 1px solid #eee;';

                    const info = document.createElement('span');
                    info.style.cssText = 'font-size: 12px; font-weight: 500;';
                    info.textContent = `${p.name} (${p.width}x${p.height})`;

                    const delBtn = document.createElement('button');
                    delBtn.textContent = '削除';
                    delBtn.style.cssText = 'background: #ff3b30; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 10px; cursor: pointer;';
                    delBtn.onclick = async () => {
                        if (confirm(`プリセット「${p.name}」を削除しますか？`)) {
                            await deletePreset(p.id);
                        }
                    };

                    row.appendChild(info);
                    row.appendChild(delBtn);
                    listContainer.appendChild(row);
                });
            }
        }
    } catch (error) {
        log("Error loading presets: " + error);
    }
}
// Setup Delete Button Visibility & Navigation
if (bookTypeEl) {
    bookTypeEl.addEventListener('change', () => {
        const val = bookTypeEl.value;

        if (val === 'create_new') {
            // Navigate to Settings > Custom Size
            settingsView.style.display = 'block';
            requestAnimationFrame(() => {
                document.body.classList.add('settings-active');
            });

            // Scroll to target section
            setTimeout(() => {
                const section = document.getElementById('customSizeSettings');
                if (section) section.scrollIntoView({ behavior: 'smooth' });
            }, 300);

            // Reset select to 'current' or previous to avoid getting stuck
            bookTypeEl.value = 'current';
            return;
        }

        if (deletePresetBtn) {
            deletePresetBtn.style.display = val.startsWith('custom_') ? 'block' : 'none';
        }

        // Ensure we save the change (if valid)
        if (val !== 'create_new') {
            saveSettings();
        }
    });
}
async function deletePreset(id) {
    const res = await chrome.storage.local.get(['windowPresets']);
    let presets = res.windowPresets || [];
    presets = presets.filter(p => p.id !== id);
    await chrome.storage.local.set({ 'windowPresets': presets });

    // reset selection if deleted
    if (bookTypeEl.value === id) {
        bookTypeEl.value = 'current';
    }

    await loadPresets();
    await saveSettings();
}

// Add Preset
if (addPresetBtn) {
    addPresetBtn.addEventListener('click', async () => {
        const name = customNameEl.value.trim();
        const width = parseInt(customWidthEl.value);
        const height = parseInt(customHeightEl.value);

        if (!name || isNaN(width) || isNaN(height)) {
            alert("名前、幅、高さを正しく入力してください。");
            return;
        }

        const id = 'custom_' + Date.now();
        const newPreset = { id, name, width, height };

        const res = await chrome.storage.local.get(['windowPresets']);
        const presets = res.windowPresets || [];
        presets.push(newPreset);

        await chrome.storage.local.set({ 'windowPresets': presets });

        // Refresh & Select (optional to select new one)
        await loadPresets();
        // bookTypeEl.value = id; // Maybe don't auto-switch if user is in settings?
        // saveSettings();

        // Reset inputs
        customNameEl.value = '';
        customWidthEl.value = '';
        customHeightEl.value = '';
        alert(`設定「${name}」を保存しました。`);
    });
}

// Hook into loadSettings to init presets
const originalLoadSettings = loadSettings;
loadSettings = function () {
    loadPresets().finally(() => {
        originalLoadSettings();
    });
};

// Hook into Start Button to resolve dimensions
const originalStartClick = startBtn.onclick; // Note: we used addEventListener, so we can't easily hook cleanly without refactor, 
// BUT we can modify the START click logic directly. 
// Since we are replacing the logic in lines 104-137, let's just make sure START logic resolves widths.

// Validate API Key before capture
async function validateApiKey(apiKey, model) {
    log("APIキーを検証中...");
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: "test" }] }]
            })
        });

        if (!response.ok) {
            const errorBody = await response.json();
            const errorMsg = errorBody.error?.message || response.statusText;

            if (response.status === 400 && errorMsg.includes("API key")) {
                return { valid: false, message: "APIキーが無効です" };
            }
            if (response.status === 403) {
                return { valid: false, message: "APIキーに権限がありません" };
            }
            if (response.status === 429) {
                return { valid: false, message: "レート制限に達しています。有料プランが必要です" };
            }
            return { valid: false, message: `エラー: ${errorMsg}` };
        }

        log("APIキー検証成功");
        return { valid: true };
    } catch (e) {
        return { valid: false, message: `接続エラー: ${e.message}` };
    }
}

startBtn.addEventListener('click', async () => {
    log("Start clicked.");
    saveSettings();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { alert("Kindle tab not found."); return; }

    const appMode = getVal('appMode');
    const apiKey = getVal('apiKey');
    const geminiModel = getVal('geminiModel');

    // Validate API key if OCR mode
    if (appMode === 'capture_ocr') {
        if (!apiKey) {
            alert("文字起こしモードを使用するにはAPIキーが必要です");
            return;
        }

        const validation = await validateApiKey(apiKey, geminiModel);
        if (!validation.valid) {
            alert(`APIキー検証失敗: ${validation.message}`);
            return;
        }

        // Check cost limit
        const costData = await chrome.storage.local.get(['costLimit', 'totalUsage']);
        const costLimit = costData.costLimit || 0;
        let totalUsage = costData.totalUsage || 0;

        if (costLimit > 0 && totalUsage >= costLimit) {
            alert(`コスト上限に達しています。\n\n累計コスト: ¥${totalUsage.toFixed(2)}\n上限: ¥${costLimit}\n\n設定画面で上限を変更するか、リセットしてください。`);
            return;
        }
    }

    // Resolve Dimensions
    let finalWidth = 0;
    let finalHeight = 0;
    const bt = getVal('bookType');

    if (bt !== 'current') {
        const selectedOpt = bookTypeEl.options[bookTypeEl.selectedIndex];
        if (selectedOpt && selectedOpt.dataset.width && selectedOpt.dataset.height) {
            finalWidth = selectedOpt.dataset.width;
            finalHeight = selectedOpt.dataset.height;
        }
    }

    const settings = {
        direction: getVal('direction'),
        outputFormat: getVal('outputFormat'),
        bookType: bt,
        width: finalWidth,
        height: finalHeight,
        appMode: appMode,
        geminiModel: geminiModel,
        ocrFormat: getVal('ocrFormat'),
        apiKey: apiKey
    };

    try {
        log("Sending Start Command to Background...");
        await chrome.runtime.sendMessage({
            action: 'START_CAPTURE',
            tabId: tab.id,
            windowId: tab.windowId,
            settings: settings
        });
        pollStatus();
    } catch (e) {
        log("Failed to start: " + e.message);
        alert("開始に失敗: " + e.message);
    }
}, { once: true });
// WARNING: The previous event listener is still attached. 
// We should replace the ENTIRE Start Button Logic block to be safe.
// Factory Reset Logic
const resetBtn = document.getElementById('resetAllSettingsBtn');
if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
        if (confirm("本当に初期化しますか？\n\n・APIキー\n・保存したプリセット\n・その他の全設定\n\nこれらがすべて削除され、初期状態に戻ります。")) {
            try {
                await chrome.storage.local.clear();
                alert("初期化が完了しました。");
                chrome.runtime.reload();
            } catch (e) {
                alert("初期化中にエラーが発生しました: " + e.message);
            }
        }
    });
}
