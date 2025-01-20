
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "saveClipboard") {
        chrome.storage.local.get("clipboardHistory", (data) => {
            let history = data.clipboardHistory || [];
            history.unshift({ text: request.text, favorite: false });
            chrome.storage.local.set({ clipboardHistory: history }, () => {
                sendResponse({ success: true });
            });
        });
        return true;
    }
});