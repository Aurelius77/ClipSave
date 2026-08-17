// Passively capture text copied on the page. We deliberately do NOT call
// preventDefault() or rewrite the clipboard — the page's own copy (including rich
// text / HTML) is left untouched. We only read the selection and hand it to the
// background script to store.
document.addEventListener("copy", () => {
    const selection = (document.getSelection() || "").toString().trim()
    if (!selection) return
    try {
        chrome.runtime.sendMessage(
            { type: "saveClipboard", text: selection, timestamp: Date.now(), origin: location.hostname },
            () => { void chrome.runtime.lastError } // swallow "no receiver" noise
        )
    } catch (err) {
        console.log(err)
    }
})
