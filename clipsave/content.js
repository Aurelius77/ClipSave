document.addEventListener("copy", (e) => {
    e.preventDefault();

    const selection = document.getSelection().toString();

    e.clipboardData.setData("text/plain", selection);

    if (selection.trim()) {
        try {
            chrome.runtime.sendMessage({ type: "saveClipboard", text: selection }, (response) => {
                if (response && response.success) {
                }
            })
        }
        catch (err) {
            console.log(err)
        };
    }
});
