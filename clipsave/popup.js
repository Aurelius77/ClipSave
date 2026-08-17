document.addEventListener("DOMContentLoaded", () => {
    // ---- Elements ----
    const clipboardList = document.getElementById("clipboardList")
    const newItemInput = document.getElementById("new-item")
    const addBtn = document.getElementById("add-btn")
    const deleteAll = document.querySelector(".delete-all")
    const clearBtn = document.getElementById("clear-search-btn")
    const searchInput = document.getElementById("search")
    const tabBar = document.getElementById("tabBar")
    const clipView = document.getElementById("clipView")
    const groupsView = document.getElementById("groupsView")
    const groupList = document.getElementById("groupList")
    const newGroupInput = document.getElementById("new-group")
    const addGroupBtn = document.getElementById("add-group-btn")
    const themeToggle = document.getElementById("themeToggle")
    const settingsView = document.getElementById("settingsView")

    if (!clipboardList || !newItemInput || !addBtn || !tabBar) {
        console.error("Error loading required element")
        return
    }

    const RECENT_LIMIT = 20
    const FREQUENT_LIMIT = 20

    // ---- State (loaded once, mutated in place, then persisted) ----
    const state = {
        clips: [],
        groups: [],
        settings: { paused: false, ignoreDomains: [], expireDays: 0, sync: false },
        activeTab: "all",   // all | recent | frequent | fav | groups | settings
        search: "",
        openGroupMenu: null, // clip id whose "add to group" menu is open
        editingClip: null,   // clip id currently being edited inline
        editingGroup: null,  // group id currently being renamed inline
        fillingClip: null,   // template clip id whose fill-in panel is open
        expandedGroups: new Set(),
        syncStatus: ""       // transient status line shown in Settings
    }

    const EXPIRE_OPTIONS = [
        { value: 0, label: "Never" },
        { value: 7, label: "After 7 days" },
        { value: 30, label: "After 30 days" },
        { value: 90, label: "After 90 days" }
    ]
    // chrome.storage.sync is tiny (~100KB total, 8KB/item), so we only sync the
    // curated set — favorites + groups — never the full rolling history.
    const SYNC_KEY = "clipsaveSync"

    // ---- Helpers ----
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;")
    }

    // Snippet templates: any clip containing {{placeholder}} tokens is a template.
    // Copying it opens a fill-in panel instead of copying the raw text.
    const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g

    // Unique placeholder names, in first-seen order.
    function getPlaceholders(text) {
        const names = []
        let m
        PLACEHOLDER_RE.lastIndex = 0
        while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
            if (!names.includes(m[1])) names.push(m[1])
        }
        return names
    }

    // Replace each {{name}} with the supplied value (missing/blank → empty string).
    function fillTemplate(text, values) {
        return text.replace(PLACEHOLDER_RE, (_, name) => {
            const v = values[name]
            return v == null ? "" : v
        })
    }

    function getTime(savedTime) {
        const now = Date.now()
        const timestamp = Number(savedTime)
        const diff = Math.floor((now - timestamp) / 1000)

        if (diff < 60) {
            return `${diff} secs ago`
        }

        const minutes = Math.floor(diff / 60)
        if (minutes < 60) {
            return `${minutes} ${minutes === 1 ? "min" : "mins"} ago`
        }

        const hours = Math.floor(minutes / 60)
        if (hours < 24) {
            return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
        }

        const days = Math.floor(hours / 24)
        return `${days} ${days === 1 ? "day" : "days"} ago`
    }

    function normalizeClip(c) {
        c = c || {}
        const ts = c.timestamp || Date.now()
        return {
            id: c.id || crypto.randomUUID(),
            text: c.text || "",
            favorite: !!c.favorite,
            timestamp: ts,
            lastUsed: c.lastUsed || ts,
            useCount: c.useCount || 0
        }
    }

    function normalizeGroup(g) {
        g = g || {}
        return {
            id: g.id || crypto.randomUUID(),
            name: g.name || "Untitled",
            clipIds: Array.isArray(g.clipIds) ? g.clipIds : []
        }
    }

    function normalizeSettings(s) {
        s = s || {}
        return {
            paused: !!s.paused,
            ignoreDomains: Array.isArray(s.ignoreDomains) ? s.ignoreDomains.filter(Boolean) : [],
            expireDays: Number(s.expireDays) || 0,
            sync: !!s.sync
        }
    }

    // Mirror of background.js expireClips: drop clips past the window, but never
    // favorites or clips that belong to a group. Returns a new array.
    function expireClips(clips, groups, expireDays) {
        if (!expireDays || expireDays <= 0) return clips
        const cutoff = Date.now() - expireDays * 24 * 60 * 60 * 1000
        const protectedIds = new Set()
        groups.forEach((g) => g.clipIds.forEach((id) => protectedIds.add(id)))
        return clips.filter((c) => {
            if (c.favorite) return true
            if (protectedIds.has(c.id)) return true
            return (c.lastUsed || c.timestamp || 0) >= cutoff
        })
    }

    // ---- Load & persist ----
    function loadState(cb) {
        chrome.storage.local.get(["clipboardHistory", "groups", "settings"], (data) => {
            const raw = data.clipboardHistory || []
            state.clips = raw.map(normalizeClip)
            state.groups = (data.groups || []).map(normalizeGroup)
            state.settings = normalizeSettings(data.settings)

            // Apply auto-expire on open (background does it on capture), then persist
            // if anything changed — including ids assigned to legacy clips.
            const before = state.clips.length
            state.clips = expireClips(state.clips, state.groups, state.settings.expireDays)
            const needsMigrate = raw.some((c) => !c || !c.id) || state.clips.length !== before
            if (needsMigrate) persistClips()
            if (cb) cb()
        })
    }

    function persistClips(cb) {
        chrome.storage.local.set({ clipboardHistory: state.clips }, cb)
    }

    function persistGroups(cb) {
        chrome.storage.local.set({ groups: state.groups }, cb)
    }

    function persistSettings(cb) {
        chrome.storage.local.set({ settings: state.settings }, cb)
    }

    // ---- Derived lists ----
    function getClipsForTab() {
        let list
        switch (state.activeTab) {
            case "recent":
                list = [...state.clips].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, RECENT_LIMIT)
                break
            case "frequent":
                list = state.clips
                    .filter((c) => c.useCount > 0)
                    .sort((a, b) => b.useCount - a.useCount)
                    .slice(0, FREQUENT_LIMIT)
                break
            case "fav":
                list = state.clips.filter((c) => c.favorite)
                break
            default: // all
                list = [...state.clips]
        }

        const q = state.search.trim().toLowerCase()
        if (q) list = list.filter((c) => c.text.toLowerCase().includes(q))
        return list
    }

    function emptyMessage() {
        if (state.search.trim()) return "No clips match your search."
        switch (state.activeTab) {
            case "recent": return "No recently used clips yet."
            case "frequent": return "No frequently used clips yet."
            case "fav": return "No favorites yet — tap ☆ on a clip to add it."
            default: return "No clips yet. Copy something, or add one above."
        }
    }

    // ---- Render ----
    function render() {
        // Tab highlight
        tabBar.querySelectorAll(".tab").forEach((t) => {
            t.classList.toggle("active", t.dataset.tab === state.activeTab)
        })

        const showGroups = state.activeTab === "groups"
        const showSettings = state.activeTab === "settings"
        clipView.classList.toggle("hidden", showGroups || showSettings)
        groupsView.classList.toggle("hidden", !showGroups)
        if (settingsView) settingsView.classList.toggle("hidden", !showSettings)

        if (showSettings) {
            renderSettings()
        } else if (showGroups) {
            renderGroups()
        } else {
            renderClips(getClipsForTab())
        }
    }

    function renderClips(list) {
        clipboardList.innerHTML = ""

        if (list.length === 0) {
            const li = document.createElement("li")
            li.className = "empty-state"
            li.textContent = emptyMessage()
            clipboardList.appendChild(li)
            return
        }

        list.forEach((item) => {
            const li = document.createElement("li")
            li.className = "clipboard-item"
            li.dataset.id = item.id

            // Inline edit mode for this clip.
            if (state.editingClip === item.id) {
                li.classList.add("editing")
                li.innerHTML = `
                    <textarea class="edit-input" rows="3">${escapeHtml(item.text)}</textarea>
                    <div class="clip-footer">
                        <span class="edit-hint">Enter to save · Esc to cancel</span>
                        <div class="clip-actions">
                            <button class="copy-btn save-edit">Save</button>
                            <button class="icon-btn cancel-edit" title="Cancel">×</button>
                        </div>
                    </div>
                `
                const ta = li.querySelector(".edit-input")
                const commit = () => saveEdit(item.id, ta.value)
                li.querySelector(".save-edit").addEventListener("click", commit)
                li.querySelector(".cancel-edit").addEventListener("click", cancelEdit)
                ta.addEventListener("keydown", (e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit() }
                    else if (e.key === "Escape") { e.preventDefault(); cancelEdit() }
                })
                clipboardList.appendChild(li)
                ta.focus()
                ta.setSelectionRange(ta.value.length, ta.value.length)
                return
            }

            const placeholders = getPlaceholders(item.text)
            const isTemplate = placeholders.length > 0

            // Inline fill-in panel for a template clip.
            if (isTemplate && state.fillingClip === item.id) {
                li.classList.add("filling")
                const fields = placeholders.map((name, i) => `
                    <label class="fill-field">
                        <span class="fill-label">${escapeHtml(name)}</span>
                        <input class="fill-input" type="text" data-name="${escapeHtml(name)}" ${i === 0 ? "autofocus" : ""} />
                    </label>`).join("")
                li.innerHTML = `
                    <div class="fill-preview">${escapeHtml(item.text)}</div>
                    <div class="fill-fields">${fields}</div>
                    <div class="clip-footer">
                        <span class="edit-hint">Fill in, then Copy · Esc to cancel</span>
                        <div class="clip-actions">
                            <button class="copy-btn fill-copy">Copy</button>
                            <button class="icon-btn fill-cancel" title="Cancel">×</button>
                        </div>
                    </div>
                `
                const inputs = Array.from(li.querySelectorAll(".fill-input"))
                const fillCopyBtn = li.querySelector(".fill-copy")
                const doCopy = () => {
                    const values = {}
                    inputs.forEach((inp) => { values[inp.dataset.name] = inp.value })
                    copyFilled(item.id, values, fillCopyBtn)
                }
                fillCopyBtn.addEventListener("click", doCopy)
                li.querySelector(".fill-cancel").addEventListener("click", () => {
                    state.fillingClip = null
                    render()
                })
                inputs.forEach((inp) => inp.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") { e.preventDefault(); doCopy() }
                    else if (e.key === "Escape") { e.preventDefault(); state.fillingClip = null; render() }
                }))
                clipboardList.appendChild(li)
                if (inputs[0]) inputs[0].focus()
                return
            }

            const badge = item.useCount > 0
                ? `<span class="use-badge" title="Copied ${item.useCount} times">${item.useCount}×</span>`
                : ""

            const templateBadge = isTemplate
                ? `<span class="tpl-badge" title="Template · ${placeholders.length} field${placeholders.length === 1 ? "" : "s"} to fill">{ }</span>`
                : ""

            const isMenuOpen = state.openGroupMenu === item.id

            // On Recent, the timestamp reflects last use; elsewhere it's creation time.
            const displayTime = state.activeTab === "recent" ? item.lastUsed : item.timestamp

            li.innerHTML = `
                <div class="item-text" title="${escapeHtml(item.text)}">${escapeHtml(item.text)}</div>
                <div class="clip-footer">
                    <div class="clip-meta">
                        <span class="time-text">${getTime(displayTime)}</span>
                        ${badge}
                        ${templateBadge}
                    </div>
                    <div class="clip-actions">
                        <button class="copy-btn" title="${isTemplate ? "Fill in & copy" : "Copy"}">${isTemplate ? "Fill" : "Copy"}</button>
                        <button class="icon-btn fav ${item.favorite ? "is-fav" : ""}" title="Favorite">${item.favorite ? "★" : "☆"}</button>
                        <button class="icon-btn group-btn ${isMenuOpen ? "active" : ""}" title="Add to group">＋</button>
                        <button class="icon-btn edit-btn" title="Edit">✎</button>
                        <button class="icon-btn delete-btn" title="Delete">🗑</button>
                    </div>
                </div>
                ${isMenuOpen ? renderGroupMenu(item) : ""}
            `

            const copyBtn = li.querySelector(".copy-btn")
            if (isTemplate) {
                // Templates don't copy raw — they open the fill-in panel.
                copyBtn.addEventListener("click", () => {
                    state.fillingClip = item.id
                    state.openGroupMenu = null
                    state.editingClip = null
                    render()
                })
            } else {
                copyBtn.addEventListener("click", () => copyToClipboard(item.id, copyBtn))
            }
            li.querySelector(".fav").addEventListener("click", () => toggleFavorite(item.id))
            li.querySelector(".group-btn").addEventListener("click", () => {
                state.openGroupMenu = isMenuOpen ? null : item.id
                render()
            })
            li.querySelector(".edit-btn").addEventListener("click", () => {
                state.editingClip = item.id
                state.openGroupMenu = null
                render()
            })
            li.querySelector(".delete-btn").addEventListener("click", () => deleteItem(item.id))

            if (isMenuOpen) wireGroupMenu(li, item)

            clipboardList.appendChild(li)
        })
    }

    function renderGroupMenu(clip) {
        const rows = state.groups.length
            ? state.groups.map((g) => `
                <label class="group-check">
                    <input type="checkbox" data-group="${g.id}" ${g.clipIds.includes(clip.id) ? "checked" : ""} />
                    <span>${escapeHtml(g.name)}</span>
                </label>`).join("")
            : `<p class="menu-empty">No groups yet — create one below.</p>`

        return `
            <div class="group-menu">
                ${rows}
                <div class="group-menu-new">
                    <input type="text" class="menu-new-input" placeholder="New group…" />
                    <button class="menu-new-btn">Add</button>
                </div>
            </div>`
    }

    function wireGroupMenu(li, clip) {
        li.querySelectorAll(".group-check input").forEach((cb) => {
            cb.addEventListener("change", () => toggleClipInGroup(clip.id, cb.dataset.group))
        })
        const input = li.querySelector(".menu-new-input")
        const btn = li.querySelector(".menu-new-btn")
        const create = () => {
            const name = input.value.trim()
            if (!name) return
            const g = addGroup(name)
            g.clipIds.push(clip.id)
            persistGroups()
            syncIfOn()
            render()
        }
        btn.addEventListener("click", create)
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") create() })
    }

    function renderGroups() {
        groupList.innerHTML = ""

        if (state.groups.length === 0) {
            const p = document.createElement("p")
            p.className = "empty-state"
            p.textContent = "No groups yet — create one above to organize your clips."
            groupList.appendChild(p)
            return
        }

        state.groups.forEach((g) => {
            const clips = g.clipIds
                .map((cid) => state.clips.find((c) => c.id === cid))
                .filter(Boolean)
            const expanded = state.expandedGroups.has(g.id)

            const isRenaming = state.editingGroup === g.id
            const card = document.createElement("div")
            card.className = "group-card"

            const headerHtml = isRenaming
                ? `<div class="group-header">
                        <input class="group-rename-input" type="text" value="${escapeHtml(g.name)}" />
                        <button class="copy-btn save-rename">Save</button>
                        <button class="icon-btn cancel-rename" title="Cancel">×</button>
                    </div>`
                : `<div class="group-header">
                        <button class="group-toggle">
                            <span class="caret">${expanded ? "▾" : "▸"}</span>
                            <span class="group-name">${escapeHtml(g.name)}</span>
                            <span class="group-count">${clips.length}</span>
                        </button>
                        <button class="icon-btn group-rename" title="Rename group">✎</button>
                        <button class="icon-btn group-delete" title="Delete group">🗑</button>
                    </div>`

            card.innerHTML = `
                ${headerHtml}
                <ul class="group-clips ${expanded && !isRenaming ? "" : "hidden"}"></ul>
            `

            if (isRenaming) {
                const input = card.querySelector(".group-rename-input")
                const commit = () => renameGroup(g.id, input.value)
                card.querySelector(".save-rename").addEventListener("click", commit)
                card.querySelector(".cancel-rename").addEventListener("click", cancelRename)
                input.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") { e.preventDefault(); commit() }
                    else if (e.key === "Escape") { e.preventDefault(); cancelRename() }
                })
            } else {
                card.querySelector(".group-toggle").addEventListener("click", () => {
                    if (expanded) state.expandedGroups.delete(g.id)
                    else state.expandedGroups.add(g.id)
                    render()
                })
                card.querySelector(".group-rename").addEventListener("click", () => {
                    state.editingGroup = g.id
                    render()
                })
                card.querySelector(".group-delete").addEventListener("click", () => deleteGroup(g.id))
            }

            if (expanded && !isRenaming) {
                const ul = card.querySelector(".group-clips")
                if (clips.length === 0) {
                    const li = document.createElement("li")
                    li.className = "empty-state small"
                    li.textContent = "No clips in this group yet."
                    ul.appendChild(li)
                } else {
                    clips.forEach((c) => {
                        const li = document.createElement("li")
                        li.className = "group-clip"
                        li.innerHTML = `
                            <span class="item-text" title="${escapeHtml(c.text)}">${escapeHtml(c.text)}</span>
                            <div class="clip-actions">
                                <button class="copy-btn" title="Copy">Copy</button>
                                <button class="icon-btn remove-from-group" title="Remove from group">×</button>
                            </div>
                        `
                        const copyBtn = li.querySelector(".copy-btn")
                        copyBtn.addEventListener("click", () => copyToClipboard(c.id, copyBtn))
                        li.querySelector(".remove-from-group")
                            .addEventListener("click", () => toggleClipInGroup(c.id, g.id))
                        ul.appendChild(li)
                    })
                }
            }

            groupList.appendChild(card)

            if (isRenaming) {
                const input = card.querySelector(".group-rename-input")
                input.focus()
                input.setSelectionRange(input.value.length, input.value.length)
            }
        })
    }

    // ---- Settings tab ----
    function renderSettings() {
        if (!settingsView) return
        const s = state.settings
        const expireOpts = EXPIRE_OPTIONS.map((o) =>
            `<option value="${o.value}" ${s.expireDays === o.value ? "selected" : ""}>${o.label}</option>`
        ).join("")

        const chips = s.ignoreDomains.length
            ? s.ignoreDomains.map((d) => `
                <span class="chip">${escapeHtml(d)}
                    <button class="chip-remove" data-domain="${escapeHtml(d)}" title="Remove" aria-label="Remove ${escapeHtml(d)}">×</button>
                </span>`).join("")
            : `<p class="settings-note">No ignored sites. Copies from every site are captured.</p>`

        settingsView.innerHTML = `
            <div class="settings">
                <div class="settings-group">
                    <div class="settings-row">
                        <div class="settings-label">
                            <span class="settings-title">Pause capture</span>
                            <p class="settings-note">Stop saving new copies. Existing clips are kept.</p>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="set-paused" ${s.paused ? "checked" : ""} />
                            <span class="slider"></span>
                        </label>
                    </div>
                    <div class="settings-row">
                        <div class="settings-label">
                            <span class="settings-title">Auto-expire clips</span>
                            <p class="settings-note">Old clips are removed. Favorites and grouped clips are always kept.</p>
                        </div>
                        <select class="set-expire" id="set-expire">${expireOpts}</select>
                    </div>
                    <div class="settings-label">
                        <span class="settings-title">Ignored sites</span>
                        <p class="settings-note">Never capture copies made on these domains (subdomains included).</p>
                    </div>
                    <div class="domain-add">
                        <input type="text" class="menu-new-input" id="domain-input" placeholder="example.com" />
                        <button class="menu-new-btn" id="domain-add-btn">Add</button>
                    </div>
                    <div class="chips">${chips}</div>
                </div>

                <div class="settings-group">
                    <div class="settings-row">
                        <div class="settings-label">
                            <span class="settings-title">Sync favorites &amp; groups</span>
                            <p class="settings-note">Share your favorites and groups across devices signed into this browser. History stays local.</p>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="set-sync" ${s.sync ? "checked" : ""} />
                            <span class="slider"></span>
                        </label>
                    </div>
                    ${state.syncStatus ? `<p class="settings-status">${escapeHtml(state.syncStatus)}</p>` : ""}
                </div>

                <div class="settings-group">
                    <div class="settings-label">
                        <span class="settings-title">Backup</span>
                        <p class="settings-note">Export everything to a file, or import a backup (merges into what you have).</p>
                    </div>
                    <div class="settings-actions">
                        <button class="secondary-btn" id="export-btn">Export JSON</button>
                        <button class="secondary-btn" id="import-btn">Import JSON</button>
                    </div>
                </div>
            </div>
        `

        settingsView.querySelector("#set-paused").addEventListener("change", (e) => {
            state.settings.paused = e.target.checked
            persistSettings()
        })
        settingsView.querySelector("#set-expire").addEventListener("change", (e) => {
            state.settings.expireDays = Number(e.target.value) || 0
            state.clips = expireClips(state.clips, state.groups, state.settings.expireDays)
            persistSettings()
            persistClips()
        })
        const domainInput = settingsView.querySelector("#domain-input")
        const addDomain = () => {
            if (addIgnoreDomain(domainInput.value)) render()
        }
        settingsView.querySelector("#domain-add-btn").addEventListener("click", addDomain)
        domainInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addDomain() })
        settingsView.querySelectorAll(".chip-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.settings.ignoreDomains = state.settings.ignoreDomains.filter((d) => d !== btn.dataset.domain)
                persistSettings()
                render()
            })
        })
        settingsView.querySelector("#set-sync").addEventListener("change", (e) => setSync(e.target.checked))
        settingsView.querySelector("#export-btn").addEventListener("click", exportData)
        settingsView.querySelector("#import-btn").addEventListener("click", importData)
    }

    // Strip protocol/path/whitespace so users can paste a URL and still get a host.
    function addIgnoreDomain(raw) {
        let d = String(raw || "").trim().toLowerCase()
        if (!d) return false
        d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")
        if (!d || state.settings.ignoreDomains.includes(d)) return false
        state.settings.ignoreDomains.push(d)
        persistSettings()
        return true
    }

    // ---- Backup: export / import ----
    function exportData() {
        const payload = {
            app: "ClipSave",
            version: 1,
            exportedAt: new Date().toISOString(),
            clips: state.clips,
            groups: state.groups,
            settings: state.settings
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `clipsave-backup-${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }

    function importData() {
        const picker = document.createElement("input")
        picker.type = "file"
        picker.accept = "application/json,.json"
        picker.addEventListener("change", () => {
            const file = picker.files && picker.files[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
                try {
                    mergeImported(JSON.parse(reader.result))
                } catch (err) {
                    console.error("Import failed:", err)
                    alert("Could not import: the file isn't valid ClipSave JSON.")
                }
            }
            reader.readAsText(file)
        })
        picker.click()
    }

    // Non-destructive merge: add clips/groups we don't already have (by id, then by
    // text for clips), and union group memberships. Existing data is never removed.
    function mergeImported(data, opts) {
        opts = opts || {}
        const incomingClips = Array.isArray(data.clips) ? data.clips.map(normalizeClip) : []
        const incomingGroups = Array.isArray(data.groups) ? data.groups.map(normalizeGroup) : []

        const byId = new Map(state.clips.map((c) => [c.id, c]))
        const byText = new Map(state.clips.map((c) => [c.text, c]))
        let addedClips = 0
        incomingClips.forEach((c) => {
            if (byId.has(c.id) || byText.has(c.text)) return
            state.clips.push(c)
            byId.set(c.id, c)
            byText.set(c.text, c)
            addedClips++
        })

        let addedGroups = 0
        incomingGroups.forEach((g) => {
            const existing = state.groups.find((x) => x.id === g.id || x.name === g.name)
            if (existing) {
                g.clipIds.forEach((id) => { if (!existing.clipIds.includes(id)) existing.clipIds.push(id) })
            } else {
                state.groups.push(g)
                addedGroups++
            }
        })

        persistClips()
        persistGroups()
        render()
        if (!opts.silent) alert(`Imported ${addedClips} clip(s) and ${addedGroups} group(s).`)
        return addedClips + addedGroups > 0
    }

    // ---- Sync (favorites + groups only, via chrome.storage.sync) ----
    // The curated bundle: every favorite plus every clip that lives in a group,
    // and all groups. History-only clips are never synced.
    function buildSyncBundle() {
        const grouped = new Set()
        state.groups.forEach((g) => g.clipIds.forEach((id) => grouped.add(id)))
        const clips = state.clips.filter((c) => c.favorite || grouped.has(c.id))
        return { clips, groups: state.groups, updatedAt: Date.now() }
    }

    function setSync(on) {
        state.settings.sync = on
        persistSettings()
        if (on) {
            pushSync()
        } else {
            state.syncStatus = "Sync off. Your synced copy stays until you clear the browser's data."
            render()
        }
    }

    function pushSync() {
        const bundle = buildSyncBundle()
        const size = JSON.stringify(bundle).length
        // storage.sync caps a single item at ~8KB; degrade gracefully if we're over.
        if (size > 8000) {
            state.syncStatus = "Too much to sync (over Chrome's ~8KB limit). Trim favorites or groups."
            render()
            return
        }
        chrome.storage.sync.set({ [SYNC_KEY]: bundle }, () => {
            if (chrome.runtime.lastError) {
                state.syncStatus = "Sync failed: " + chrome.runtime.lastError.message
            } else {
                state.syncStatus = "Synced favorites & groups just now."
            }
            render()
        })
    }

    function pullSync() {
        chrome.storage.sync.get(SYNC_KEY, (data) => {
            const bundle = data[SYNC_KEY]
            if (bundle) mergeImported(bundle, { silent: true })
            pushSync() // converge: seed the cloud if empty, or share local-only items
        })
    }

    function syncIfOn() {
        if (state.settings.sync) pushSync()
    }

    // ---- Mutations ----
    function addClip(text) {
        const now = Date.now()
        // Dedup: refresh an existing identical clip and move it to the top
        // (keeps its id so group memberships, favorite, and useCount survive).
        const existingIndex = state.clips.findIndex((c) => c.text === text)
        let entry
        if (existingIndex !== -1) {
            entry = state.clips.splice(existingIndex, 1)[0]
            entry.timestamp = now
            entry.lastUsed = now
        } else {
            entry = { id: crypto.randomUUID(), text, favorite: false, timestamp: now, lastUsed: now, useCount: 0 }
        }
        state.clips.unshift(entry)
        persistClips()
        render()
    }

    function copyToClipboard(id, button) {
        const clip = state.clips.find((c) => c.id === id)
        if (!clip) return
        navigator.clipboard
            .writeText(clip.text)
            .then(() => {
                const originalText = button.textContent
                button.textContent = "Copied!"
                button.classList.add("copied")
                setTimeout(() => {
                    button.textContent = originalText
                    button.classList.remove("copied")
                }, 1500)

                // Track usage for the Recent / Frequent tabs (reflected on next render).
                clip.useCount = (clip.useCount || 0) + 1
                clip.lastUsed = Date.now()
                persistClips()
            })
            .catch((err) => {
                console.error("Failed to copy text: ", err)
                button.textContent = "Error"
                button.classList.add("error")
                setTimeout(() => {
                    button.textContent = "Copy"
                    button.classList.remove("error")
                }, 1500)
            })
    }

    function toggleFavorite(id) {
        const clip = state.clips.find((c) => c.id === id)
        if (!clip) return
        clip.favorite = !clip.favorite
        persistClips()
        syncIfOn()
        render()
    }

    // Copy a template's filled-in result. The panel stays open so the user can
    // tweak values and copy again; each copy counts as a use.
    function copyFilled(id, values, button) {
        const clip = state.clips.find((c) => c.id === id)
        if (!clip) return
        const result = fillTemplate(clip.text, values)
        navigator.clipboard
            .writeText(result)
            .then(() => {
                button.textContent = "Copied!"
                button.classList.add("copied")
                setTimeout(() => {
                    button.textContent = "Copy"
                    button.classList.remove("copied")
                }, 1500)

                clip.useCount = (clip.useCount || 0) + 1
                clip.lastUsed = Date.now()
                persistClips()
            })
            .catch((err) => {
                console.error("Failed to copy text: ", err)
                button.textContent = "Error"
                button.classList.add("error")
                setTimeout(() => {
                    button.textContent = "Copy"
                    button.classList.remove("error")
                }, 1500)
            })
    }

    function saveEdit(id, newText) {
        const text = newText.trim()
        const clip = state.clips.find((c) => c.id === id)
        // Blank text just cancels the edit rather than storing an empty clip.
        if (clip && text) {
            clip.text = text
            persistClips()
        }
        state.editingClip = null
        render()
    }

    function cancelEdit() {
        state.editingClip = null
        render()
    }

    function deleteItem(id) {
        state.clips = state.clips.filter((c) => c.id !== id)
        // Drop the clip from any groups it belonged to, so no dangling refs remain.
        state.groups.forEach((g) => {
            g.clipIds = g.clipIds.filter((cid) => cid !== id)
        })
        if (state.openGroupMenu === id) state.openGroupMenu = null
        if (state.editingClip === id) state.editingClip = null
        if (state.fillingClip === id) state.fillingClip = null
        persistClips()
        persistGroups()
        syncIfOn()
        render()
    }

    // Adds a group to state and returns it (caller persists + renders).
    function addGroup(name) {
        const g = { id: crypto.randomUUID(), name: name.trim(), clipIds: [] }
        state.groups.push(g)
        return g
    }

    function deleteGroup(id) {
        if (!confirm("Delete this group? The clips themselves stay in your history.")) return
        state.groups = state.groups.filter((g) => g.id !== id)
        state.expandedGroups.delete(id)
        if (state.editingGroup === id) state.editingGroup = null
        persistGroups()
        syncIfOn()
        render()
    }

    function renameGroup(id, newName) {
        const name = newName.trim()
        const g = state.groups.find((x) => x.id === id)
        if (g && name) {
            g.name = name
            persistGroups()
            syncIfOn()
        }
        state.editingGroup = null
        render()
    }

    function cancelRename() {
        state.editingGroup = null
        render()
    }

    function toggleClipInGroup(clipId, groupId) {
        const g = state.groups.find((x) => x.id === groupId)
        if (!g) return
        const i = g.clipIds.indexOf(clipId)
        if (i >= 0) g.clipIds.splice(i, 1)
        else g.clipIds.push(clipId)
        persistGroups()
        syncIfOn()
        render()
    }

    // ---- Static event wiring ----

    // Theme toggle (light/dark). theme.js already applied any saved choice to
    // <html> before paint; here we keep the button in sync and let the user flip
    // it. A click always writes an explicit choice, which overrides the OS setting.
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)")

    function effectiveTheme() {
        const saved = document.documentElement.dataset.theme
        if (saved === "light" || saved === "dark") return saved
        return prefersDark.matches ? "dark" : "light"
    }

    function syncThemeButton() {
        if (!themeToggle) return
        const isDark = effectiveTheme() === "dark"
        // Show the icon for the mode you'll switch TO.
        themeToggle.textContent = isDark ? "☀️" : "🌙"
        themeToggle.title = isDark ? "Switch to light mode" : "Switch to dark mode"
    }

    function toggleTheme() {
        const next = effectiveTheme() === "dark" ? "light" : "dark"
        document.documentElement.dataset.theme = next
        try { localStorage.setItem("clipsave-theme", next) } catch (e) { /* ignore */ }
        syncThemeButton()
    }

    if (themeToggle) {
        themeToggle.addEventListener("click", toggleTheme)
        // Keep the icon right if the OS theme changes while we're still on "system".
        prefersDark.addEventListener("change", syncThemeButton)
        syncThemeButton()
    }

    tabBar.addEventListener("click", (e) => {
        const btn = e.target.closest(".tab")
        if (!btn) return
        state.activeTab = btn.dataset.tab
        state.search = ""
        if (searchInput) searchInput.value = ""
        state.openGroupMenu = null
        state.editingClip = null
        state.editingGroup = null
        state.fillingClip = null
        state.syncStatus = ""
        render()
    })

    function handleAdd() {
        const text = newItemInput.value.trim()
        if (!text) return
        addClip(text)
        newItemInput.value = ""
    }
    addBtn.addEventListener("click", handleAdd)
    newItemInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleAdd() })

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            state.search = searchInput.value
            render()
        })
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            state.search = ""
            if (searchInput) searchInput.value = ""
            render()
        })
    }

    if (deleteAll) {
        deleteAll.addEventListener("click", () => {
            if (!confirm("Delete all clips? This cannot be undone.")) return
            state.clips = []
            // Clips are gone, so clear every group's membership too (keep the groups).
            state.groups.forEach((g) => { g.clipIds = [] })
            state.openGroupMenu = null
            persistClips()
            persistGroups()
            syncIfOn()
            render()
        })
    }

    function handleAddGroup() {
        const name = newGroupInput.value.trim()
        if (!name) return
        addGroup(name)
        newGroupInput.value = ""
        persistGroups()
        syncIfOn()
        render()
    }
    if (addGroupBtn) addGroupBtn.addEventListener("click", handleAddGroup)
    if (newGroupInput) {
        newGroupInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleAddGroup() })
    }

    // ---- Init ----
    loadState(() => {
        render()
        // If sync is on, pull remote favorites/groups on open, then converge.
        if (state.settings.sync) pullSync()
    })
})
