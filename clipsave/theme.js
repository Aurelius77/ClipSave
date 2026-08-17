// Applies the saved light/dark choice to <html> before the popup paints, so
// there's no flash of the wrong theme. Runs from <head> — only touches
// documentElement, so it needs no DOM. (Inline scripts are blocked by MV3's
// CSP, so this lives in its own file.)
(function () {
    try {
        const saved = localStorage.getItem("clipsave-theme")
        if (saved === "light" || saved === "dark") {
            document.documentElement.dataset.theme = saved
        }
    } catch (e) {
        // localStorage unavailable — fall back to the OS preference.
    }
})()