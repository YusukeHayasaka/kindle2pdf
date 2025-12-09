console.log("Kindle to PDF Content Script Loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Message received:", request);
    if (request.action === "NEXT_PAGE") {
        const direction = request.direction || 'left';

        // Define click targets
        let x, key;
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Kindle Cloud Reader often uses an iframe or specific overlay div.
        // Clicking 'body' might not work if an overlay captures it.
        // We will try to click elements at the edge.

        if (direction === 'right') {
            // Right-to-Left (Vertical/Manga): Next page is on the LEFT side.
            x = 50;
            key = 'ArrowLeft';
        } else {
            // Left-to-Right: Next page is on the RIGHT side.
            x = width - 50;
            key = 'ArrowRight';
        }

        console.log(`Simulating navigation: ${direction} (Key: ${key}, ClickX: ${x})`);

        // 1. Keyboard Event (often most reliable for Kindle)
        const keyEvent = new KeyboardEvent('keydown', {
            key: key,
            code: key,
            keyCode: (key === 'ArrowRight' ? 39 : 37),
            which: (key === 'ArrowRight' ? 39 : 37),
            bubbles: true,
            cancelable: true,
            view: window
        });
        document.dispatchEvent(keyEvent);
        document.body.dispatchEvent(keyEvent); // Try body too

        // 2. Click Simulation (Fallback)
        // Try multiple vertical positions to avoid menus
        const yPositions = [height / 2, height * 0.8, height * 0.2];

        yPositions.forEach(y => {
            const el = document.elementFromPoint(x, y);
            console.log(`Clicking at (${x}, ${y}) on element:`, el);

            const clickEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y
            });

            if (el) {
                el.dispatchEvent(clickEvent);
            }
            // Dispatch to window/body as backup
            window.dispatchEvent(clickEvent);
        });

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
    }
    return true; // Keep channel open
});
