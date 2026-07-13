import { app, BrowserWindow, screen, shell } from 'electron'
import { join, normalize, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { BrowserHandoff, UpdateAvailability } from '@shared/types'
import { isSafeExternalUrl } from './protocol'
import { loadSettings } from './settings'
// Explicit window icon: the running app's taskbar button then never depends on
// Windows resolving the exe icon (which a stale icon cache can break after
// in-place upgrades).
import appIconPath from '../../build/icon.ico?asset'

let mainWindow: BrowserWindow | null = null
let quickWindow: BrowserWindow | null = null
const pendingSettingsWindows = new Set<number>()

// Once quitting starts, the quick window's hide-instead-of-close interception
// must stand down or app.quit() would be blocked forever.
let isQuitting = false
app.on('before-quit', () => {
  isQuitting = true
})

// Lets index.ts re-evaluate quit-when-idle when a window closes or hides
// ('window-all-closed' never fires while the warm quick window exists).
let windowIdleProbe: (() => void) | null = null
export function setWindowIdleProbe(probe: () => void): void {
  windowIdleProbe = probe
}

export function hasVisibleWindow(): boolean {
  return BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isVisible())
}

// URLs are queued for the renderer they were intended for. A single process-
// global slot lets a main window steal a quick-window handoff and drops rapid
// consecutive browser clicks.
const pendingExternalUrls = new Map<number, string[]>()
const readyRenderers = new Set<number>()
let latestAvailableUpdate: UpdateAvailability | null = null

const packagedRendererPath = resolve(__dirname, '../renderer/index.html')

function samePath(left: string, right: string): boolean {
  const a = normalize(resolve(left))
  const b = normalize(resolve(right))
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

// Used both by navigation guards and IPC authorization. Only the exact local
// renderer file (or the configured Vite dev server page) is trusted.
export function isTrustedRendererUrl(value: string): boolean {
  try {
    const candidate = new URL(value)
    const devUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      const expected = new URL(devUrl)
      return candidate.origin === expected.origin && candidate.pathname === expected.pathname
    }
    return candidate.protocol === 'file:' && samePath(fileURLToPath(candidate), packagedRendererPath)
  } catch {
    return false
  }
}

export function isKnownRenderer(webContentsId: number): boolean {
  return [mainWindow, quickWindow].some(
    (win) => !!win && !win.isDestroyed() && win.webContents.id === webContentsId
  )
}

function webPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    spellcheck: false
  }
}

function loadRenderer(win: BrowserWindow, hash?: string): void {
  const rendererUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void win.loadURL(hash ? `${rendererUrl}#${hash}` : rendererUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function openSafeExternalUrl(value: string): void {
  if (!isSafeExternalUrl(value)) return
  void shell.openExternal(new URL(value).toString()).catch((err) => {
    console.error('[snag] Could not open external URL:', err)
  })
}

function hardenNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternalUrl(url)
    return { action: 'deny' }
  })

  const guard = (event: Electron.Event, url: string): void => {
    if (isTrustedRendererUrl(url)) return
    event.preventDefault()
    openSafeExternalUrl(url)
  }
  win.webContents.on('will-navigate', guard)
  win.webContents.on('will-redirect', guard)
}

function trackRenderer(win: BrowserWindow): void {
  const id = win.webContents.id
  const markNotReady = (): void => {
    readyRenderers.delete(id)
  }
  win.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) markNotReady()
  })
  win.webContents.on('render-process-gone', markNotReady)
  win.webContents.once('destroyed', () => {
    readyRenderers.delete(id)
    pendingExternalUrls.delete(id)
  })
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d0e12',
    title: 'Snag',
    icon: appIconPath,
    webPreferences: webPreferences()
  })

  mainWindow = win
  win.on('ready-to-show', () => win.show())
  // In tray mode the X button hides the window (kept warm for an instant
  // reopen from the tray) instead of destroying it. With tray mode off, the
  // window closes normally and the app quits once downloads finish.
  win.on('close', (event) => {
    if (isQuitting || !loadSettings().runInBackground) return
    event.preventDefault()
    win.hide()
    windowIdleProbe?.()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    windowIdleProbe?.()
  })

  hardenNavigation(win)
  trackRenderer(win)
  loadRenderer(win)
  return win
}

export function ensureMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) return createMainWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  return mainWindow
}

export function openSettingsWindow(): void {
  const win = ensureMainWindow()
  if (win.webContents.isLoading()) pendingSettingsWindows.add(win.webContents.id)
  else win.webContents.send('openSettings')
}

export function consumePendingOpenSettings(webContentsId: number): boolean {
  if (!pendingSettingsWindows.delete(webContentsId)) return false
  return true
}

const QUICK_WIDTH = 460
const QUICK_HEIGHT = 640
const QUICK_MARGIN = 14

// Pin the popup to the top-right of the screen the user is working on — the
// same corner as the browser's extension buttons that trigger the handoff.
function positionQuickWindow(win: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  win.setPosition(
    Math.round(area.x + area.width - QUICK_WIDTH - QUICK_MARGIN),
    Math.round(area.y + QUICK_MARGIN)
  )
}

// Tradeoff: the warm renderer is a hidden Chromium process (~60–100 MB) that
// would otherwise live for the app's whole lifetime. Ten minutes keeps
// back-to-back extension handoffs instant while letting everyone else shed
// the RAM — the next handoff just cold-starts the window again, since
// prewarming is only an optimization on top of ensureQuickWindow.
const QUICK_IDLE_TIMEOUT_MS = 10 * 60 * 1000

let quickIdleTimer: NodeJS.Timeout | null = null

function clearQuickIdleTimer(): void {
  if (quickIdleTimer) {
    clearTimeout(quickIdleTimer)
    quickIdleTimer = null
  }
}

// A quit in progress must not race a late destroy, and the timer must never
// keep the event loop from settling after before-quit.
app.on('before-quit', clearQuickIdleTimer)

// Drop the warm quick window once it has sat hidden and unused long enough.
function armQuickIdleTimer(): void {
  clearQuickIdleTimer()
  quickIdleTimer = setTimeout(() => {
    quickIdleTimer = null
    if (isQuitting || !quickWindow || quickWindow.isDestroyed() || quickWindow.isVisible()) return
    // destroy() bypasses the hide-instead-of-close interception in 'close',
    // so re-run the idle probe the same way an ordinary hide would.
    quickWindow.destroy()
    windowIdleProbe?.()
  }, QUICK_IDLE_TIMEOUT_MS)
}

function createQuickWindow(options: { reveal: boolean }): BrowserWindow {
  const win = new BrowserWindow({
    width: QUICK_WIDTH,
    height: QUICK_HEIGHT,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    show: false,
    skipTaskbar: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d0e12',
    title: 'Snag — quick download',
    icon: appIconPath,
    webPreferences: webPreferences()
  })

  quickWindow = win
  positionQuickWindow(win)
  if (options.reveal) {
    win.once('ready-to-show', () => win.show())
  }

  // Keep the window (and its loaded renderer) warm: closing only hides it, so
  // the next browser handoff appears instantly instead of cold-starting.
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
    windowIdleProbe?.()
  })
  win.on('closed', () => {
    if (quickWindow === win) {
      quickWindow = null
      clearQuickIdleTimer()
    }
  })
  // Active extension users keep the warm window between downloads; each hide
  // re-arms the countdown, each show cancels it.
  win.on('hide', armQuickIdleTimer)
  win.on('show', clearQuickIdleTimer)

  hardenNavigation(win)
  trackRenderer(win)
  loadRenderer(win, 'quick')
  return win
}

// Load the quick renderer invisibly ahead of time (first handoff is instant).
export function prewarmQuickWindow(): void {
  if (!quickWindow || quickWindow.isDestroyed()) {
    createQuickWindow({ reveal: false })
    // The window starts hidden, so 'hide' never fires — start the idle
    // countdown here in case no handoff ever arrives.
    armQuickIdleTimer()
  }
}

export function ensureQuickWindow(): BrowserWindow {
  if (!quickWindow || quickWindow.isDestroyed()) return createQuickWindow({ reveal: true })
  positionQuickWindow(quickWindow)
  quickWindow.show()
  quickWindow.focus()
  return quickWindow
}

function flushQueuedUrls(webContentsId: number): void {
  const win = [mainWindow, quickWindow].find(
    (candidate) => candidate && !candidate.isDestroyed() && candidate.webContents.id === webContentsId
  )
  const queue = pendingExternalUrls.get(webContentsId)
  if (!win || win.isDestroyed() || !queue?.length || !readyRenderers.has(webContentsId)) return

  pendingExternalUrls.delete(webContentsId)
  for (const url of queue) win.webContents.send('externalUrl', url)
}

// Called after the renderer has registered its listeners. Deliver on the next
// event-loop turn rather than consuming a value in the invoke response; this
// survives React StrictMode's development mount/unmount cycle without losing
// the first handoff.
export function consumePendingExternalUrl(webContentsId: number): string | null {
  readyRenderers.add(webContentsId)
  setTimeout(() => {
    flushQueuedUrls(webContentsId)
    if (
      latestAvailableUpdate &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      readyRenderers.has(webContentsId) &&
      mainWindow.webContents.id === webContentsId
    ) {
      mainWindow.webContents.send('updateAvailable', latestAvailableUpdate)
    }
  }, 0)
  return null
}

// Route a validated http(s) URL to the chosen window. If its renderer is still
// loading, preserve every handoff for that exact window instead of overwriting.
export function deliverExternalUrl(url: string, handoff: BrowserHandoff): void {
  const win = handoff === 'main' ? ensureMainWindow() : ensureQuickWindow()
  const id = win.webContents.id
  if (readyRenderers.has(id)) {
    win.webContents.send('externalUrl', url)
  } else {
    const queue = pendingExternalUrls.get(id) ?? []
    queue.push(url)
    pendingExternalUrls.set(id, queue)
  }
}

// Cache automatic update availability until the full main UI is ready. This
// prevents a quick-only launch from consuming the sole notification.
export function publishUpdateAvailability(update: UpdateAvailability): void {
  latestAvailableUpdate = update.app || update.ytdlp ? update : null
  if (
    latestAvailableUpdate &&
    mainWindow &&
    !mainWindow.isDestroyed() &&
    readyRenderers.has(mainWindow.webContents.id)
  ) {
    mainWindow.webContents.send('updateAvailable', latestAvailableUpdate)
  }
}

export function clearCachedYtdlpUpdate(): void {
  if (!latestAvailableUpdate?.ytdlp) return
  latestAvailableUpdate = latestAvailableUpdate.app
    ? { ...latestAvailableUpdate, ytdlp: null }
    : null
}

export function clearCachedUpdates(): void {
  latestAvailableUpdate = null
}
