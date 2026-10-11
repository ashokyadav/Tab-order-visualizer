// Injects (or toggles off) the visualizer in the active tab.
// MAIN world so the script can see handlers the page set with el.onclick = fn.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^(https?|file):/.test(tab.url || '')) return; // chrome:// and the Web Store can't be scripted
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['tov.js'], world: 'MAIN' });
  } catch (err) {
    console.warn('Tab Order Visualizer could not run on this page:', err);
  }
});
