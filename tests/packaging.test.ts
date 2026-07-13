import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

describe('Windows packaging', () => {
  it('ships the tray image and retains an application-icon fallback', () => {
    const builder = readFileSync('electron-builder.yml', 'utf8')
    const tray = readFileSync('src/main/tray.ts', 'utf8')

    expect(builder).toContain('- resources/tray.png')
    expect(builder).toContain('- CHANGELOG.md')
    expect(tray).toContain("import trayIconPath from '../../resources/tray.png?asset'")
    expect(tray).toContain("import appIconPath from '../../build/icon.ico?asset'")
    expect(tray).toContain('bundledTrayIcon.isEmpty()')
  })

  it('prepares and refreshes the stable Chrome extension folder on every launch', () => {
    const extension = readFileSync('src/main/extension.ts', 'utf8')
    const content = readFileSync('extension/content.js', 'utf8')
    expect(extension).toContain('export function refreshInstalledBrowserExtension(): ExtensionInstallResult')
    expect(extension).toContain('return installBrowserExtension()')
    expect(extension).not.toContain('if (!getInstalledExtensionPath()) return null')
    expect(content).toContain('const analysisByUrl = new Map()')
    expect(content).toContain('prefetchAnalysis(video)')
    expect(content).toContain('requestAnalysis(pageUrl)')
    expect(content).toContain("video.closest('ytd-video-preview')")
    expect(content).toContain('https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}')
    expect(content).toContain("el('strong', null, 'Opened in Snag')")
    expect(content).not.toContain('void start()\n          return')
    expect(readFileSync('extension/background.js', 'utf8')).toContain("apiFetch(port, '/health'")
    expect(content).toContain('Set your preferred audio language in Settings.')
    expect(content).toContain("type: 'snag:open-settings'")
    expect(content).toContain('state.groups.filter((g) => favorites.includes(langBase(g.language)))')

    const windows = readFileSync('src/main/windows.ts', 'utf8')
    const preload = readFileSync('src/preload/index.ts', 'utf8')
    expect(windows).toContain("win.webContents.send('openSettings')")
    expect(preload).toContain("ipcRenderer.on('openSettings', listener)")
  })

  it('opens Telegram with the file and retains the Windows Share fallback', () => {
    const ipc = readFileSync('src/main/ipc.ts', 'utf8')
    expect(ipc).toContain("$verb.DoIt()")
    expect(ipc).toContain("spawn(telegram, ['--', telegramTarget]")
    expect(ipc).toContain("`${basename(target, extname(target))}.webm`")
    expect(ipc).toContain('linkSync(target, shareTarget)')
    expect(ipc).toContain('cleanupTelegramMediaPath(job.filepath)')
    expect(ipc).toContain('recentTelegramShares')
    expect(ipc).toContain('return openWindowsShareSheet(target)')
    expect(ipc).toContain("handleTrusted('shareFile'")
    expect(ipc).toContain("handleTrusted('deleteCompletedFiles'")
  })
})
