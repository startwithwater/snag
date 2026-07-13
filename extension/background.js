// Snag for Chrome — background service worker.
// Two jobs: (1) bridge the in-page panel to Snag's loopback API using the
// pairing token from config.js or automatic loopback pairing, and (2) keep the
// classic snag:// deep-link actions for toolbar/context-menu use and as the
// fallback when the app isn't running.

importScripts('config.js')

const MENU_PAGE = 'snag-page'
const MENU_LINK = 'snag-link'
const MENU_VIDEO = 'snag-video'
const MENU_TOGGLE = 'snag-toggle-site'
const VERSION_ALARM = 'snag-check-app-version'

function deepLink(url) {
  return 'snag://download?url=' + encodeURIComponent(url)
}

function isHttp(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

// ---------- Loopback API bridge ----------

let workingPort = null
let pairingToken = (SNAG_CONFIG && SNAG_CONFIG.token) || ''
const DEFAULT_PORTS = [43110, 43111, 43112, 43113, 43114, 43115, 43116, 43117]

async function loadPairingToken() {
  if (pairingToken) return pairingToken
  const stored = await chrome.storage.local.get('snagPairingToken')
  pairingToken = typeof stored.snagPairingToken === 'string' ? stored.snagPairingToken : ''
  return pairingToken
}

async function savePairingToken(token) {
  pairingToken = token
  if (token) await chrome.storage.local.set({ snagPairingToken: token })
  else await chrome.storage.local.remove('snagPairingToken')
}

async function apiFetch(port, path, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      ...options,
      headers: {
        ...(pairingToken ? { Authorization: 'Bearer ' + pairingToken } : {}),
        'Content-Type': 'application/json',
        ...(options && options.headers)
      },
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

async function pairWithSnag(port) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 900)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal
    })
    if (!res.ok) return false
    const data = await res.json()
    if (!data || data.app !== 'snag' || typeof data.token !== 'string') return false
    await savePairingToken(data.token)
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// Find the port Snag is listening on (cached once found; re-scanned on failure).
// The panel fires several requests at once — share one scan between them
// instead of probing every port per request.
let findSnagPromise = null

function findSnag() {
  if (!findSnagPromise) {
    findSnagPromise = scanForSnag().finally(() => {
      findSnagPromise = null
    })
  }
  return findSnagPromise
}

async function scanForSnag() {
  await loadPairingToken()
  const configuredPorts = Array.isArray(SNAG_CONFIG && SNAG_CONFIG.ports)
    ? SNAG_CONFIG.ports
    : []
  const ports = [...new Set([...configuredPorts, ...DEFAULT_PORTS])]
  const candidates = workingPort
    ? [workingPort, ...ports.filter((p) => p !== workingPort)]
    : ports
  for (const port of candidates) {
    try {
      if (!pairingToken && !(await pairWithSnag(port))) continue
      const res = await apiFetch(port, '/ping', { method: 'GET' }, 900)
      if (res.ok) {
        const data = await res.json()
        if (data && data.app === 'snag') {
          workingPort = port
          return port
        }
      }
      if (res.status === 401) {
        await savePairingToken('')
        if (await pairWithSnag(port)) {
          const retry = await apiFetch(port, '/ping', { method: 'GET' }, 900)
          if (retry.ok) {
            workingPort = port
            return port
          }
        }
      }
    } catch {
      /* try next port */
    }
  }
  workingPort = null
  return null
}

// Liveness-only probe used while a deep link is starting Snag. Unlike
// findSnag(), this never calls /pair and therefore cannot multiply pairing
// attempts while the app is still booting.
async function findRunningSnag() {
  const configuredPorts = Array.isArray(SNAG_CONFIG && SNAG_CONFIG.ports)
    ? SNAG_CONFIG.ports
    : []
  const ports = [...new Set([...configuredPorts, ...DEFAULT_PORTS])]
  const candidates = workingPort
    ? [workingPort, ...ports.filter((p) => p !== workingPort)]
    : ports
  for (const port of candidates) {
    try {
      const res = await apiFetch(port, '/health', { method: 'GET' }, 500)
      if (!res.ok) continue
      const data = await res.json()
      if (data && data.app === 'snag') {
        workingPort = port
        return port
      }
    } catch {
      /* try next port */
    }
  }
  return null
}

async function callSnag(path, options, timeoutMs) {
  const port = await findSnag()
  if (port == null) return { ok: false, error: 'not-running' }
  try {
    const res = await apiFetch(port, path, options, timeoutMs)
    const data = await res.json()
    if (res.status === 401) return { ok: false, error: 'not-paired' }
    return { ok: res.ok, data }
  } catch {
    workingPort = null
    return { ok: false, error: 'not-running' }
  }
}

// Snag refreshes its stable unpacked-extension folder whenever the desktop app
// starts. After one manual reload installs this code, future app upgrades are
// detected here and Chrome reloads the extension from that refreshed folder.
async function reloadForNewAppVersion() {
  const port = await findSnag()
  if (port == null) return
  try {
    const res = await apiFetch(port, '/ping', { method: 'GET' }, 1200)
    if (!res.ok) return
    const data = await res.json()
    if (!data || data.app !== 'snag' || typeof data.version !== 'string') return
    const stored = await chrome.storage.local.get('snagObservedAppVersion')
    const previous = stored.snagObservedAppVersion
    await chrome.storage.local.set({ snagObservedAppVersion: data.version })
    await apiFetch(port, '/extension/heartbeat', { method: 'POST', body: '{}' }, 1200)
    if (typeof previous === 'string' && previous !== data.version) chrome.runtime.reload()
  } catch {
    /* Snag may be starting or shutting down; the next alarm retries. */
  }
}

chrome.alarms.create(VERSION_ALARM, { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === VERSION_ALARM) void reloadForNewAppVersion()
})
chrome.runtime.onStartup.addListener(() => void reloadForNewAppVersion())
void reloadForNewAppVersion()

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false

  if (message.type === 'snag:ping') {
    findRunningSnag().then((port) => sendResponse({ running: port != null }))
    return true
  }
  if (message.type === 'snag:defaults') {
    callSnag('/defaults', { method: 'GET' }, 3000).then(sendResponse)
    return true
  }
  if (message.type === 'snag:open-settings') {
    callSnag('/open-settings', { method: 'POST', body: '{}' }, 3000).then(sendResponse)
    return true
  }
  if (message.type === 'snag:analyze') {
    callSnag(
      '/analyze',
      { method: 'POST', body: JSON.stringify({ url: message.url }) },
      45000
    ).then(sendResponse)
    return true
  }
  if (message.type === 'snag:enqueue') {
    callSnag(
      '/enqueue',
      { method: 'POST', body: JSON.stringify(message.request) },
      8000
    ).then(sendResponse)
    return true
  }
  if (message.type === 'snag:job') {
    callSnag(`/jobs/${encodeURIComponent(message.jobId || '')}`, { method: 'GET' }, 3000).then(sendResponse)
    return true
  }
  if (message.type === 'snag:cancel') {
    callSnag(
      `/jobs/${encodeURIComponent(message.jobId || '')}/cancel`,
      { method: 'POST', body: '{}' },
      3000
    ).then(sendResponse)
    return true
  }
  if (message.type === 'snag:set-audio-favorites') {
    callSnag(
      '/preferences/audio-languages',
      { method: 'POST', body: JSON.stringify({ languages: message.languages }) },
      3000
    ).then(sendResponse)
    return true
  }
  return false
})

// ---------- Deep-link actions (toolbar, context menus, fallback) ----------

async function sendToSnag(tabId, targetUrl) {
  if (!isHttp(targetUrl)) return
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (link) => {
        window.location.href = link
      },
      args: [deepLink(targetUrl)]
    })
  } catch {
    // Restricted page (chrome://, Web Store, PDF viewer) — nothing we can do.
  }
}

async function toggleSite(tab) {
  let host
  try {
    host = new URL(tab.url).hostname
  } catch {
    return
  }
  if (!host) return
  const { disabledSites = [] } = await chrome.storage.local.get('disabledSites')
  const idx = disabledSites.indexOf(host)
  if (idx >= 0) disabledSites.splice(idx, 1)
  else disabledSites.push(host)
  // Content scripts on this site react via chrome.storage.onChanged.
  await chrome.storage.local.set({ disabledSites })
}

chrome.runtime.onInstalled.addListener(() => {
  // Recreate deterministically on extension updates; existing IDs otherwise
  // make the onInstalled handler fail partway through.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title: 'Download this page with Snag',
      contexts: ['page']
    })
    chrome.contextMenus.create({
      id: MENU_VIDEO,
      title: 'Download this video with Snag',
      contexts: ['video', 'audio']
    })
    chrome.contextMenus.create({
      id: MENU_LINK,
      title: 'Download link with Snag',
      contexts: ['link']
    })
    chrome.contextMenus.create({
      id: MENU_TOGGLE,
      title: 'Show/hide Snag button on this site',
      contexts: ['page', 'video']
    })
  })
})

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id != null) sendToSnag(tab.id, tab.url)
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return
  switch (info.menuItemId) {
    case MENU_PAGE:
      sendToSnag(tab.id, info.pageUrl || tab.url)
      break
    case MENU_VIDEO:
      // Media src is usually a useless blob: URL — the page (or embed frame)
      // URL is what yt-dlp can actually extract from.
      sendToSnag(tab.id, info.frameUrl || info.pageUrl || tab.url)
      break
    case MENU_LINK:
      sendToSnag(tab.id, info.linkUrl)
      break
    case MENU_TOGGLE:
      toggleSite(tab)
      break
  }
})
