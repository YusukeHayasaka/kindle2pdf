console.log("Kindle to PDF Content Script Loaded");

// MutationObserver-based DOM stability detection
let domStabilityObserver = null;
let domStabilityTimeout = null;

function waitForDomStability(stableMs = 1000, maxWaitMs = 15000) {
    return new Promise((resolve) => {
        let lastChangeTime = Date.now();
        const startTime = Date.now();

        // Disconnect any existing observer
        if (domStabilityObserver) {
            domStabilityObserver.disconnect();
        }

        // Create observer that resets the timer on any DOM change
        domStabilityObserver = new MutationObserver(() => {
            lastChangeTime = Date.now();
            console.log('[K2PDF] DOM changed, resetting stability timer');
        });

        // Observe the entire document for any changes
        domStabilityObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
        });

        // Check periodically if DOM has been stable
        const checkStability = () => {
            const now = Date.now();
            const timeSinceLastChange = now - lastChangeTime;
            const totalElapsed = now - startTime;

            // Also check if loader element exists
            const loaderExists = document.querySelector('.loader') ||
                document.querySelector('.kg-loader') ||
                document.querySelector('[role="progressbar"]');

            if (loaderExists) {
                console.log('[K2PDF] Loader still present, waiting...');
                lastChangeTime = now; // Reset timer while loader is present
            }

            if (timeSinceLastChange >= stableMs && !loaderExists) {
                // DOM has been stable for the required duration
                console.log('[K2PDF] DOM stable for ' + stableMs + 'ms');
                domStabilityObserver.disconnect();
                domStabilityObserver = null;
                resolve(true);
            } else if (totalElapsed >= maxWaitMs) {
                // Timeout - proceed anyway
                console.log('[K2PDF] Stability timeout after ' + maxWaitMs + 'ms');
                domStabilityObserver.disconnect();
                domStabilityObserver = null;
                resolve(false);
            } else {
                // Check again in 100ms
                setTimeout(checkStability, 100);
            }
        };

        // Start checking after a small delay
        setTimeout(checkStability, 100);
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Message received:", request);
    if (request.action === "NEXT_PAGE") {
        const direction = request.direction || 'left';
        let key, clickX, turnIds;

        const width = window.innerWidth;
        const height = window.innerHeight;

        if (direction === 'right') {
            // Right-to-Left (Manga): Next is Left
            key = 'ArrowLeft';
            clickX = 50;
            turnIds = ['#kindleReader_pageTurnAreaLeft', '#kindleReader_button_arrow_left'];
        } else {
            // Left-to-Right (Text): Next is Right
            key = 'ArrowRight';
            clickX = width - 50;
            turnIds = ['#kindleReader_pageTurnAreaRight', '#kindleReader_button_arrow_right'];
        }

        console.log(`Navigating: ${direction} (Key: ${key})`);

        // 1. Try Clicking Specific Elements
        let clicked = false;
        turnIds.forEach(id => {
            const el = document.querySelector(id);
            if (el) {
                console.log(`Clicking ID: ${id}`);
                ['mousedown', 'mouseup', 'click'].forEach(evtType => {
                    el.dispatchEvent(new MouseEvent(evtType, {
                        bubbles: true, cancelable: true, view: window, composed: true
                    }));
                });
                clicked = true;
            }
        });

        // 2. Keyboard Event (Fallback & Standard)
        const keyCode = (key === 'ArrowRight' ? 39 : 37);
        ['keydown', 'keyup'].forEach(evtType => {
            const evt = new KeyboardEvent(evtType, {
                key: key, code: key, keyCode: keyCode, which: keyCode,
                bubbles: true, cancelable: true, composed: true, view: window
            });
            document.dispatchEvent(evt);
            document.body.dispatchEvent(evt);
        });

        // 3. Coordinate Click (Fallback)
        if (!clicked) {
            // Try multiple heights
            [height * 0.5, height * 0.8].forEach(y => {
                const el = document.elementFromPoint(clickX, y);
                if (el) {
                    ['mousedown', 'mouseup', 'click'].forEach(evtType => {
                        el.dispatchEvent(new MouseEvent(evtType, {
                            bubbles: true, cancelable: true, view: window,
                            clientX: clickX, clientY: y, composed: true
                        }));
                    });
                }
            });
        }

        sendResponse({ status: "done" });
    } else if (request.action === "GO_TO_START") {
        console.log("Navigating to start (Home key)...");
        const keyEvent = new KeyboardEvent('keydown', {
            key: 'Home',
            code: 'Home',
            keyCode: 36,
            which: 36,
            bubbles: true,
            cancelable: true,
            view: window
        });
        document.dispatchEvent(keyEvent);
        document.body.dispatchEvent(keyEvent);

        // Also try clicking left/right edge repeatedly? No, Home is better.
        // Some Kindle readers interpret 'Home' as library. 
        // Let's assume this works for the viewer. 
        // If not, we might need to rely on the user manually going to start, 
        // but let's try this.

        sendResponse({ status: "done" });
    } else if (request.action === "GET_METADATA") {
        // Only scan in top frame to avoid conflicting/empty responses from iframes
        if (window.self !== window.top) {
            return;
        }

        console.log("Scanning metadata (Top Frame)...");
        let total = 0;
        let title = "kindle_book";

        // ... (rest of logic) ...
        const scan = async () => {
            // ...
            // (Same scan logic as before)
            // ...
            // Copy the existing scan function body here, but ensure total/title scaping works
            // Since replace_file_content is exact match, I need to provide the full block or use multi_replace.
            // I'll provide the logic here.

            let attempts = 0;
            while (attempts < 5 && total === 0) {
                if (document.title) {
                    title = document.title
                        .replace(/^Amazon\.co\.jp[:\s]*/, '')
                        .replace(/^Amazon\.com[:\s]*/, '')
                        .replace(/ - Kindle Cloud Reader$/, '')
                        .trim();
                }

                const selectors = [
                    '#kindleReader_footer_message',
                    '#footer',
                    '.footer',
                    '#kindleReader_pageNums',
                    '#kindleReader_progress_bar',
                    '.kindleReader_footer_message'
                ];

                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.textContent) {
                        const text = el.textContent;
                        const match = text.match(/(?:of|\/|全)\s*(\d+)/i);
                        if (match) {
                            total = parseInt(match[1]);
                            break;
                        }
                    }
                }

                if (total === 0) {
                    await new Promise(r => setTimeout(r, 500));
                    attempts++;
                }
            }
            sendResponse({ status: "done", totalPages: total, bookTitle: title });
        };
        scan();
        return true;

    } else if (request.action === "WAIT_FOR_STABLE") {
        // Use MutationObserver to wait for DOM stability
        const stableMs = request.stableMs || 1000;
        const maxWaitMs = request.maxWaitMs || 15000;

        waitForDomStability(stableMs, maxWaitMs).then((isStable) => {
            sendResponse({ stable: isStable });
        });
        return true; // Keep channel open for async response

    } else if (request.action === "IS_LOADING") {
        // Check for Kindle Cloud Reader's specific loader (highest priority)
        // If .loader or .kg-loader exists in the DOM, the page is loading
        const kindleLoader = document.querySelector('.loader') ||
            document.querySelector('.kg-loader') ||
            document.querySelector('[role="progressbar"]');

        if (kindleLoader) {
            console.log('[K2PDF] Kindle loader detected in DOM');
            sendResponse({ isLoading: true });
            return true;
        }

        // Check for other loading indicators with visibility check
        const spinnerSelectors = [
            '.loading_spinner',
            '.spinner',
            '.loading',
            '#kindleReader_loading',
            '[class*="loading"]',
            '[class*="spinner"]',
            '[aria-busy="true"]'
        ];

        let spinnerVisible = false;
        for (const selector of spinnerSelectors) {
            try {
                const el = document.querySelector(selector);
                if (el && el.offsetParent !== null) {
                    spinnerVisible = true;
                    console.log('[K2PDF] Spinner detected:', selector);
                    break;
                }
            } catch (e) { /* ignore */ }
        }

        // Check if images are still loading
        const images = document.querySelectorAll('img');
        let imagesLoading = false;
        for (const img of images) {
            if (!img.complete || img.naturalHeight === 0) {
                imagesLoading = true;
                break;
            }
        }

        // Check for canvas elements (Kindle often uses canvas for rendering)
        const canvases = document.querySelectorAll('canvas');
        let canvasEmpty = false;
        for (const canvas of canvases) {
            if (canvas.width === 0 || canvas.height === 0) {
                canvasEmpty = true;
                break;
            }
        }

        // Check for blur/fade overlay (Kindle uses these during page transitions)
        const overlays = document.querySelectorAll('[class*="overlay"]') ||
            document.querySelectorAll('[class*="Overlay"]');
        let overlayVisible = false;
        for (const overlay of overlays) {
            const style = window.getComputedStyle(overlay);
            if (style.opacity > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
                overlayVisible = true;
                break;
            }
        }

        // Check for elements with transition/animation in progress
        const allElements = document.querySelectorAll('*');
        let hasActiveTransition = false;
        for (const el of allElements) {
            const style = window.getComputedStyle(el);
            // Check if opacity is between 0 and 1 (transitioning)
            const opacity = parseFloat(style.opacity);
            if (opacity > 0 && opacity < 0.95) {
                hasActiveTransition = true;
                break;
            }
        }

        const isLoading = spinnerVisible || imagesLoading || canvasEmpty || overlayVisible || hasActiveTransition;
        sendResponse({ isLoading: isLoading });
    }
    return true; // Keep channel open
});
