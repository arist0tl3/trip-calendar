// Open the side panel when the user clicks the toolbar icon.
// This must be set once at install time.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(console.error);
});
