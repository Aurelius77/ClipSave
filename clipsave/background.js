
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "saveClipboard") {
        chrome.storage.local.get("clipboardHistory", (data) => {
            let history = data.clipboardHistory || [];
            history.unshift({ text: request.text, favorite: false, timestamp: request.timestamp });
            const MAX_HISTORY_ITEMS = 100
            if (history.length > MAX_HISTORY_ITEMS) {
                history = history.slice(0, MAX_HISTORY_ITEMS)
            }

            chrome.storage.local.set({ clipboardHistory: history }, () => {
                sendResponse({ success: true });
            });
        });
        return true;
    }
});