
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "saveClipboard") {
        chrome.storage.local.get(["clipboardHistory", "groups", "settings"], (data) => {
            const settings = data.settings || {}

            // Privacy gate: don't capture while paused or on an ignored domain.
            if (settings.paused || originIsIgnored(request.origin, settings.ignoreDomains)) {
                sendResponse({ success: false, skipped: true })
                return
            }

            let history = data.clipboardHistory || [];

            // Dedup: if this exact text is already saved, refresh it and move it to
            // the top instead of adding a duplicate (preserve id/favorite/useCount).
            const existingIndex = history.findIndex((c) => c && c.text === request.text);
            let entry;
            if (existingIndex !== -1) {
                entry = history.splice(existingIndex, 1)[0];
                entry.timestamp = request.timestamp;
                entry.lastUsed = request.timestamp;
                if (!entry.id) entry.id = crypto.randomUUID();
            } else {
                entry = {
                    id: crypto.randomUUID(),
                    text: request.text,
                    favorite: false,
                    timestamp: request.timestamp,
                    lastUsed: request.timestamp,
                    useCount: 0
                };
            }
            history.unshift(entry);

            const MAX_HISTORY_ITEMS = 100
            if (history.length > MAX_HISTORY_ITEMS) {
                history = history.slice(0, MAX_HISTORY_ITEMS)
            }

            // Opportunistic auto-expire (also runs when the popup opens).
            history = expireClips(history, data.groups, settings.expireDays)

            chrome.storage.local.set({ clipboardHistory: history }, () => {
                sendResponse({ success: true });
            });
        });
        return true;
    }
});
