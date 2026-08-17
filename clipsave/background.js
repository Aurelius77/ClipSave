
// Case-insensitive host match: an entry matches its exact host or any subdomain
// (e.g. "bank.com" also matches "mail.bank.com").
function originIsIgnored(origin, ignoreDomains) {
    if (!origin || !Array.isArray(ignoreDomains)) return false
    const host = String(origin).toLowerCase()
    return ignoreDomains.some((d) => {
        const dom = String(d || "").toLowerCase()
        return dom && (host === dom || host.endsWith("." + dom))
    })
}

// Drop clips past the expiry window, except favorites and clips that belong to a
// group — curated data is protected. Mirrored in popup.js so both paths agree.
function expireClips(history, groups, expireDays) {
    if (!expireDays || expireDays <= 0) return history
    const cutoff = Date.now() - expireDays * 24 * 60 * 60 * 1000
    const protectedIds = new Set()
    const gs = Array.isArray(groups) ? groups : []
    gs.forEach((g) => {
        const ids = g && Array.isArray(g.clipIds) ? g.clipIds : []
        ids.forEach((id) => protectedIds.add(id))
    })
    return history.filter((c) => {
        if (!c) return false
        if (c.favorite) return true
        if (protectedIds.has(c.id)) return true
        const t = c.lastUsed || c.timestamp || 0
        return t >= cutoff
    })
}

const MAX_HISTORY_ITEMS = 100

// Save a clip, honoring the privacy gate, dedup, the 100-item cap, and auto-expire.
// Shared by the copy listener and the right-click context menu. `cb` (optional)
// receives { success, skipped? }.
function saveClip(text, timestamp, origin, cb) {
    chrome.storage.local.get(["clipboardHistory", "groups", "settings"], (data) => {
        const settings = data.settings || {}

        // Privacy gate: don't capture while paused or on an ignored domain.
        if (settings.paused || originIsIgnored(origin, settings.ignoreDomains)) {
            if (cb) cb({ success: false, skipped: true })
            return
        }

        let history = data.clipboardHistory || []

        // Dedup: if this exact text is already saved, refresh it and move it to
        // the top instead of adding a duplicate (preserve id/favorite/useCount).
        const existingIndex = history.findIndex((c) => c && c.text === text)
        let entry
        if (existingIndex !== -1) {
            entry = history.splice(existingIndex, 1)[0]
            entry.timestamp = timestamp
            entry.lastUsed = timestamp
            if (!entry.id) entry.id = crypto.randomUUID()
        } else {
            entry = {
                id: crypto.randomUUID(),
                text: text,
                favorite: false,
                timestamp: timestamp,
                lastUsed: timestamp,
                useCount: 0
            }
        }
        history.unshift(entry)

        if (history.length > MAX_HISTORY_ITEMS) {
            history = history.slice(0, MAX_HISTORY_ITEMS)
        }

        // Opportunistic auto-expire (also runs when the popup opens).
        history = expireClips(history, data.groups, settings.expireDays)

        chrome.storage.local.set({ clipboardHistory: history }, () => {
            if (cb) cb({ success: true })
        })
    })
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "saveClipboard") {
        saveClip(request.text, request.timestamp, request.origin, sendResponse)
        return true
    }
})

// ---- Right-click "Save to ClipSave" on selected text ----
// removeAll first so re-creating on install/update never throws a duplicate-id error.
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "clipsave-save-selection",
            title: "Save to ClipSave",
            contexts: ["selection"]
        })
    })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== "clipsave-save-selection") return
    const text = (info.selectionText || "").trim()
    if (!text) return
    let origin = ""
    try {
        origin = new URL(info.pageUrl || (tab && tab.url) || "").hostname
    } catch (e) { /* no usable URL — save without an origin */ }
    saveClip(text, Date.now(), origin)
})
