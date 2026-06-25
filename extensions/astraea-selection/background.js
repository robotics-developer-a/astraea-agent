const BRIDGE = 'http://127.0.0.1:8765';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ask-astraea-selection',
    title: 'Ask Astraea',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'ask-astraea-selection') return;

  const payload = {
    instruction: '',
    selection: info.selectionText || '',
    source: {
      kind: 'webpage',
      title: tab?.title || '',
      url: tab?.url || '',
    },
  };

  try {
    const response = await fetch(`${BRIDGE}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Draft creation failed');
    chrome.tabs.create({ url: `${BRIDGE}/?draft=${encodeURIComponent(data.id)}` });
  } catch {
    const params = new URLSearchParams({
      selection: payload.selection,
      kind: 'webpage',
      title: payload.source.title,
      url: payload.source.url,
    });
    chrome.tabs.create({ url: `${BRIDGE}/?${params.toString()}` });
  }
});
