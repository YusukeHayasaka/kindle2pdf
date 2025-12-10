const defaultPrompt = `Transcribe all text in this image (Japanese/English). 
Output ONLY the transcribed text.
Rules:
1. Preserve original layout (paragraphs, line breaks) as much as possible.
2. EXCLUDE all headers and footers (e.g. "Page 10 of 200", "Location 300", Book Titles repeated on top/bottom).
3. EXCLUDE Kindle UI text such as "Learning Reading Speed", "X% left", etc.
4. Do not perform any conversation. Do not say "Here is the transcription". Just output the text content.`;

const promptEl = document.getElementById('customPrompt');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const msgEl = document.getElementById('message');

// Load settings
function load() {
    chrome.storage.local.get(['customPrompt'], (res) => {
        if (res.customPrompt) {
            promptEl.value = res.customPrompt;
        } else {
            promptEl.value = defaultPrompt;
        }
    });
}

// Save settings
function save() {
    const val = promptEl.value;
    chrome.storage.local.set({ customPrompt: val }, () => {
        msgEl.textContent = "設定を保存しました。";
        setTimeout(() => { msgEl.textContent = ""; }, 2000);
    });
}

// Reset to default
function reset() {
    if (confirm("プロンプトを初期値に戻しますか？")) {
        promptEl.value = defaultPrompt;
        save();
    }
}

document.addEventListener('DOMContentLoaded', load);
saveBtn.addEventListener('click', save);
resetBtn.addEventListener('click', reset);
