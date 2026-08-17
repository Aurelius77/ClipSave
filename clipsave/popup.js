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
        activeTab: "all",   // all | recent | frequent | fav | groups
        search: "",
        openGroupMenu: null, // clip id whose "add to group" menu is open
        expandedGroups: new Set()
    }

    // ---- Helpers ----
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;")
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

    // ---- Load & persist ----
    function loadState(cb) {
        chrome.storage.local.get(["clipboardHistory", "groups"], (data) => {
            const raw = data.clipboardHistory || []
            const needsMigrate = raw.some((c) => !c || !c.id)
            state.clips = raw.map(normalizeClip)
            state.groups = (data.groups || []).map(normalizeGroup)
            // Persist once if we assigned ids to legacy clips, so they stay stable.
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
        clipView.classList.toggle("hidden", showGroups)
        groupsView.classList.toggle("hidden", !showGroups)

        if (showGroups) {
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

            const badge = item.useCount > 0
                ? `<span class="use-badge" title="Copied ${item.useCount} times">${item.useCount}×</span>`
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
                    </div>
                    <div class="clip-actions">
                        <button class="copy-btn" title="Copy">Copy</button>
                        <button class="icon-btn fav ${item.favorite ? "is-fav" : ""}" title="Favorite">${item.favorite ? "★" : "☆"}</button>
                        <button class="icon-btn group-btn ${isMenuOpen ? "active" : ""}" title="Add to group">＋</button>
                        <button class="icon-btn delete-btn" title="Delete">🗑</button>
                    </div>
                </div>
                ${isMenuOpen ? renderGroupMenu(item) : ""}
            `

            const copyBtn = li.querySelector(".copy-btn")
            copyBtn.addEventListener("click", () => copyToClipboard(item.id, copyBtn))
            li.querySelector(".fav").addEventListener("click", () => toggleFavorite(item.id))
            li.querySelector(".group-btn").addEventListener("click", () => {
                state.openGroupMenu = isMenuOpen ? null : item.id
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

            const card = document.createElement("div")
            card.className = "group-card"
            card.innerHTML = `
                <div class="group-header">
                    <button class="group-toggle">
                        <span class="caret">${expanded ? "▾" : "▸"}</span>
                        <span class="group-name">${escapeHtml(g.name)}</span>
                        <span class="group-count">${clips.length}</span>
                    </button>
                    <button class="icon-btn group-delete" title="Delete group">🗑</button>
                </div>
                <ul class="group-clips ${expanded ? "" : "hidden"}"></ul>
            `

            card.querySelector(".group-toggle").addEventListener("click", () => {
                if (expanded) state.expandedGroups.delete(g.id)
                else state.expandedGroups.add(g.id)
                render()
            })
            card.querySelector(".group-delete").addEventListener("click", () => deleteGroup(g.id))

            if (expanded) {
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
        })
    }

    // ---- Mutations ----
    function addClip(text) {
        const now = Date.now()
        state.clips.unshift({
            id: crypto.randomUUID(),
            text,
            favorite: false,
            timestamp: now,
            lastUsed: now,
            useCount: 0
        })
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
        render()
    }

    function deleteItem(id) {
        state.clips = state.clips.filter((c) => c.id !== id)
        // Drop the clip from any groups it belonged to, so no dangling refs remain.
        state.groups.forEach((g) => {
            g.clipIds = g.clipIds.filter((cid) => cid !== id)
        })
        if (state.openGroupMenu === id) state.openGroupMenu = null
        persistClips()
        persistGroups()
        render()
    }

    // Adds a group to state and returns it (caller persists + renders).
    function addGroup(name) {
        const g = { id: crypto.randomUUID(), name: name.trim(), clipIds: [] }
        state.groups.push(g)
        return g
    }

    function deleteGroup(id) {
        state.groups = state.groups.filter((g) => g.id !== id)
        state.expandedGroups.delete(id)
        persistGroups()
        render()
    }

    function toggleClipInGroup(clipId, groupId) {
        const g = state.groups.find((x) => x.id === groupId)
        if (!g) return
        const i = g.clipIds.indexOf(clipId)
        if (i >= 0) g.clipIds.splice(i, 1)
        else g.clipIds.push(clipId)
        persistGroups()
        render()
    }

    // ---- Static event wiring ----
    tabBar.addEventListener("click", (e) => {
        const btn = e.target.closest(".tab")
        if (!btn) return
        state.activeTab = btn.dataset.tab
        state.search = ""
        if (searchInput) searchInput.value = ""
        state.openGroupMenu = null
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
            render()
        })
    }

    function handleAddGroup() {
        const name = newGroupInput.value.trim()
        if (!name) return
        addGroup(name)
        newGroupInput.value = ""
        persistGroups()
        render()
    }
    if (addGroupBtn) addGroupBtn.addEventListener("click", handleAddGroup)
    if (newGroupInput) {
        newGroupInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleAddGroup() })
    }

    // ---- Init ----
    loadState(render)
})
