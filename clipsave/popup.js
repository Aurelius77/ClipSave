//comment are so you get which function is which. #don'tsayididn't drop it


document.addEventListener("DOMContentLoaded", () => {
    const clipboardList = document.getElementById("clipboardList")
    const newItemInput = document.getElementById("new-item")
    const addBtn = document.getElementById("add-btn")
    const favorite_Toggle = document.getElementById('favorite-toggle')
    const deleteAll = document.querySelector('.delete-all')


    if (!clipboardList || !newItemInput || !addBtn || !favorite_Toggle) {
        console.error("Error loding required element")
        return
    }

    let favouriteList = false

    // Render the clips
    function renderClipboardList(history) {
        clipboardList.innerHTML = ""
        const filteredHistory = favouriteList ? history.filter((item) => item.favorite) : history
        filteredHistory.forEach((item, index) => {
            const li = document.createElement("li")
            li.className = "clipboard-item"
            li.innerHTML = `
                <span class='item-text'>${item.text}</span>
                <div class='options'>
                    <button class="copy-btn">Copy</button>
                    <button class="fav">${item.favorite ? "★" : "☆"}</button>
                    <button class="delete-btn">Delete</button>
                </div>
            `
            const copyBtn = li.querySelector(".copy-btn")
            li.querySelector(".copy-btn").addEventListener("click", () => copyToClipboard(item.text, copyBtn))
            li.querySelector(".fav").addEventListener("click", () => toggleFavorite(index))
            li.querySelector(".delete-btn").addEventListener("click", () => deleteItem(index))
            clipboardList.appendChild(li)
        })
    }

    // Add new item
    addBtn.addEventListener("click", () => {
        const text = newItemInput.value.trim()
        if (text) {
            chrome.storage.local.get("clipboardHistory", (data) => {
                const history = data.clipboardHistory || []
                history.unshift({ text, favorite: false })
                chrome.storage.local.set({ clipboardHistory: history }, () => {
                    renderClipboardList(history)
                    newItemInput.value = ""
                })
            })
        }
    })

    // Copy text to clipboard
    function copyToClipboard(text, button) {
        navigator.clipboard
            .writeText(text)
            .then(() => {
                const originalText = button.textContent
                button.textContent = "Copied!"
                button.classList.add("copied")

                setTimeout(() => {
                    button.textContent = originalText
                    button.classList.remove("copied")
                }, 2000)
            })
            .catch((err) => {
                console.error("Failed to copy text: ", err)
            })
    }

    // Toggle favorite
    function toggleFavorite(index) {
        chrome.storage.local.get("clipboardHistory", (data) => {
            const history = data.clipboardHistory || []
            history[index].favorite = !history[index].favorite
            chrome.storage.local.set({ clipboardHistory: history }, () => {
                renderClipboardList(history)
            })
        })
    }


    //diplay favorites only
    favorite_Toggle.addEventListener('change', () => {
        favouriteList = favorite_Toggle.checked
        chrome.storage.local.get('clipboardHistory', (data) => {
            const history = data.clipboardHistory || []
            renderClipboardList(history)
        })
    })



    // Delete an item
    function deleteItem(index) {
        chrome.storage.local.get("clipboardHistory", (data) => {
            const history = data.clipboardHistory || []
            history.splice(index, 1)
            chrome.storage.local.set({ clipboardHistory: history }, () => {
                renderClipboardList(history)
            })
        })
    }


    //delete all items

    deleteAll.addEventListener('click', () => {
        const history = []
        chrome.storage.local.set({ clipboardHistory: history }, () => {
            renderClipboardList(history)
        })
    })

    // Initial render
    chrome.storage.local.get("clipboardHistory", (data) => {
        const history = data.clipboardHistory || []
        renderClipboardList(history)
    })
})

