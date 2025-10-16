chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "saveToBrain",
      title: "Save to Brain",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "askToBrain",
      title: "Ask to Brain",
      contexts: ["selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "saveToBrain") {
    const selectedText = info.selectionText;
    console.log("Text selected from context menu (Save to Brain):", selectedText);
    alert(`Selected text saved to Brain: "${selectedText}"`);
  } else if (info.menuItemId === "askToBrain") {
    const selectedText = info.selectionText;
    console.log("Text selected from context menu (Ask to Brain):", selectedText);
    alert(`Asking Brain about: "${selectedText}"`);
  }
});