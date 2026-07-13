// Snag for Chrome — content script.
// Pins one floating download button to the top-right corner of every
// large-enough <video>. Clicking it slides a quality-picker panel down from
// the button, right on top of the page — analyze, pick, download, all without
// leaving the video. Falls back to snag:// links when the app isn't running.

;(() => {
  const MIN_WIDTH = 250
  const MIN_HEIGHT = 140
  const BTN_SIZE = 36
  const INSET = 10
  const PANEL_WIDTH = 300
  const HOST = location.hostname

  let disabled = false
  const buttons = new Map() // <video> element -> its button element
  const analysisByUrl = new Map()
  let prefetchTimer = null
  let prefetchUrl = null

  const LANG_NAMES = {
    en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian',
    pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', ru: 'Russian', uk: 'Ukrainian',
    tr: 'Turkish', ar: 'Arabic', hi: 'Hindi', bn: 'Bengali', ja: 'Japanese',
    ko: 'Korean', zh: 'Chinese', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian',
    fa: 'Persian', ur: 'Urdu', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam',
    mr: 'Marathi', pa: 'Punjabi', sv: 'Swedish', no: 'Norwegian', da: 'Danish',
    fi: 'Finnish', cs: 'Czech', el: 'Greek', ro: 'Romanian', hu: 'Hungarian'
  }

  function langBase(code) {
    return String(code || '').toLowerCase().split('-')[0]
  }
  function langLabel(code) {
    if (!code) return 'Original'
    return LANG_NAMES[langBase(code)] || code.toUpperCase()
  }

  function formatBytes(n) {
    if (!n || !isFinite(n) || n <= 0) return '—'
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
    return (n >= 100 || i === 0 ? Math.round(n) : i >= 3 ? n.toFixed(2) : n.toFixed(1)) + ' ' + units[i]
  }

  function shortPath(p) {
    if (!p) return ''
    const parts = p.split(/[\\/]/)
    return parts.length > 2 ? '…\\' + parts.slice(-2).join('\\') : p
  }

  function deepLink(url) {
    return 'snag://download?url=' + encodeURIComponent(url || location.href)
  }

  // The page URL is not always the video's URL. On X/Twitter the feed itself
  // is not extractable — resolve the enclosing tweet's permalink instead.
  function resolveTargetUrl(video) {
    if (/(^|\.)youtube\.com$/i.test(HOST)) {
      // Homepage hover previews are portaled into a global ytd-video-preview,
      // outside the thumbnail card. YouTube keeps the real watch link inside
      // that preview even though the <video> itself has no useful ancestor URL.
      const preview = video && video.closest && video.closest('ytd-video-preview')
      const previewLink = preview && preview.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]')
      const candidate = previewLink ? previewLink.href : location.href
      try {
        const parsed = new URL(candidate, location.origin)
        const videoId = parsed.searchParams.get('v')
        if (videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
        const short = parsed.pathname.match(/^\/shorts\/([\w-]+)/)
        if (short) return `https://www.youtube.com/shorts/${short[1]}`
      } catch {
        // Fall through to the normal page URL.
      }
    }
    if (/(^|\.)(x\.com|twitter\.com)$/i.test(HOST)) {
      const statusRe = /\/([A-Za-z0-9_]+)\/status\/(\d+)/
      const article = video && video.closest && video.closest('article')
      if (article) {
        for (const a of article.querySelectorAll('a[href*="/status/"]')) {
          const m = (a.getAttribute('href') || '').match(statusRe)
          if (m) return `https://${HOST}/${m[1]}/status/${m[2]}`
        }
      }
      const m = location.pathname.match(statusRe)
      if (m) return `https://${HOST}/${m[1]}/status/${m[2]}`
    }
    return location.href
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: 'extension' })
          else resolve(res || { ok: false, error: 'extension' })
        })
      } catch {
        resolve({ ok: false, error: 'extension' })
      }
    })
  }

  function requestAnalysis(url) {
    let request = analysisByUrl.get(url)
    if (!request) {
      request = sendMessage({ type: 'snag:analyze', url }).then((result) => {
        if (!result || result.error === 'not-running' || result.error === 'not-paired' || result.error === 'extension') {
          analysisByUrl.delete(url)
        }
        return result
      })
      analysisByUrl.set(url, request)
      while (analysisByUrl.size > 8) analysisByUrl.delete(analysisByUrl.keys().next().value)
    }
    return request
  }

  function prefetchAnalysis(video) {
    const url = resolveTargetUrl(video)
    if (analysisByUrl.has(url)) return
    if (prefetchTimer && prefetchUrl === url) return
    clearTimeout(prefetchTimer)
    prefetchUrl = url
    prefetchTimer = setTimeout(() => {
      prefetchTimer = null
      prefetchUrl = null
      void requestAnalysis(url)
    }, 700)
  }

  // ---------- Container compatibility (friendly codec names from Snag) ----------

  const VIDEO_COMPAT = {
    mp4: /^(H\.264|H\.265|AV1)/i,
    webm: /^(VP9|VP8|AV1)/i,
    mkv: /./
  }
  const AUDIO_COMPAT = {
    mp4: /^(AAC|AC-3)/i,
    webm: /^(Opus|Vorbis)/i,
    mkv: /./
  }

  // Unknown codecs (blank strings from X/Twitter) pass when the source file
  // is already in the container's family — mirrors Snag's own rules.
  function videoOk(container, f) {
    if (container === 'mkv') return true
    if (!f.vcodec) return f.ext === (container === 'mp4' ? 'mp4' : 'webm')
    return VIDEO_COMPAT[container].test(f.vcodec)
  }
  function audioOk(container, f) {
    if (container === 'mkv') return true
    if (!f.acodec) return container === 'mp4' ? f.ext === 'm4a' || f.ext === 'mp4' : f.ext === 'webm'
    return AUDIO_COMPAT[container].test(f.acodec)
  }

  function compatibleAudio(container, group) {
    const ok = (group.formats || []).filter((f) => audioOk(container, f))
    ok.sort((a, b) => {
      const nativeA = container === 'mp4' ? a.ext === 'm4a' : a.ext === 'webm'
      const nativeB = container === 'mp4' ? b.ext === 'm4a' : b.ext === 'webm'
      if (nativeA !== nativeB) return nativeA ? -1 : 1
      return (b.abr || 0) - (a.abr || 0)
    })
    return ok[0] || null
  }

  function qualityLabel(height) {
    if (height <= 0) return 'Best'
    if (height >= 4320) return '8K'
    if (height >= 2160) return '4K'
    if (height >= 1440) return '2K'
    return `${height}p`
  }

  function recommendedRow(rows, multipleAudio, preferred) {
    return (multipleAudio && rows.find((r) => r.container === 'mkv')) ||
      (!multipleAudio && rows.find((r) => r.container === 'mp4')) ||
      rows.find((r) => r.container === preferred) || rows[0] || null
  }

  // Best stream for each container at the explicitly selected resolution.
  function rowsForQuality(info, selectedGroups, targetHeight) {
    const rows = []
    for (const container of ['mp4', 'mkv', 'webm']) {
      const candidates = (info.videoFormats || []).filter((f) => {
        if (info.hasMultipleAudioLanguages && f.isProgressive) return false
        if (!videoOk(container, f)) return false
        if (f.isProgressive && f.acodec && f.acodec !== 'none' && !AUDIO_COMPAT[container].test(f.acodec)) return false
        return true
      })
      if (!candidates.length) continue
      let pool = candidates.filter((f) => (f.height || 0) === targetHeight)
      if (!pool.length) continue
      const maxFps = Math.max(...pool.map((f) => f.fps || 0))
      pool = pool.filter((f) => (f.fps || 0) === maxFps)
      pool.sort((a, b) => (a.filesize ?? Infinity) - (b.filesize ?? Infinity) || (b.tbr || 0) - (a.tbr || 0))
      const video = pool[0]

      const tracks = video.isProgressive
        ? []
        : selectedGroups.map((g) => compatibleAudio(container, g)).filter(Boolean)
      if (!video.isProgressive && !tracks.length) continue

      let total = video.filesize
      let approx = video.filesizeIsApprox
      for (const t of tracks) {
        if (total != null && t.filesize != null) total += t.filesize
        else approx = true
      }
      rows.push({ container, video, tracks, total, approx })
    }
    return rows
  }

  // ---------- Panel ----------

  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
    .num { font-variant-numeric: tabular-nums; }
    .panel {
      width: ${PANEL_WIDTH}px; max-height: 78vh; overflow-y: auto; overscroll-behavior: contain;
      background: linear-gradient(180deg, #191c23, #14161c); color: #eef0f3;
      border: 1px solid rgba(255,255,255,0.14); border-radius: 16px;
      box-shadow: 0 24px 60px -18px rgba(0,0,0,0.85);
      font-size: 13px; line-height: 1.45;
      transform-origin: top right; animation: snagIn 0.30s cubic-bezier(0.2, 0.9, 0.28, 1.12) both;
    }
    .panel:focus-visible { outline: 2px solid #c6f24d; outline-offset: 3px; }
    .panel.closing { animation: snagOut 0.16s ease both; }
    @keyframes snagIn { from { opacity: .35; transform: scale(0.09); border-radius: 50%; } to { opacity: 1; transform: none; border-radius: 16px; } }
    @keyframes snagOut { from { opacity: 1; transform: none; } to { opacity: .2; transform: scale(0.09); border-radius: 50%; } }
    .panel::-webkit-scrollbar { width: 9px; }
    .panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
    .panel button { font-family: inherit; }

    /* header */
    .head { display: flex; align-items: center; gap: 10px; padding: 11px 12px 10px; border-bottom: 1px solid rgba(255,255,255,0.07); }
    .thumb { width: 58px; height: 36px; border-radius: 8px; flex-shrink: 0; position: relative; overflow: hidden; background: linear-gradient(135deg,#2c3446 0%,#1a2030 55%,#39303f 100%); }
    .thumb::after { content: ''; position: absolute; inset: 0; margin: auto; width: 0; height: 0; border-left: 9px solid rgba(255,255,255,0.85); border-top: 6px solid transparent; border-bottom: 6px solid transparent; }
    .thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .head-txt { flex: 1; min-width: 0; }
    .head-txt .t { font-weight: 600; font-size: 13px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .head-txt .m { color: #6f757f; font-size: 11px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dot { width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0; background: linear-gradient(150deg,#c6f24d,#a9e02f); display: grid; place-items: center; }
    .dot svg { width: 15px; height: 15px; stroke: #17200a; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .x { width: 26px; height: 26px; border: 0; background: none; color: #a7adb7; cursor: pointer; border-radius: 7px; font-size: 14px; flex-shrink: 0; }
    .x:hover { background: rgba(255,255,255,0.08); color: #fff; }

    /* segmented Video / Audio */
    .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; margin: 10px 12px 0; padding: 3px; background: #0f1116; border: 1px solid rgba(255,255,255,0.07); border-radius: 11px; position: relative; }
    .seg-ind { position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc(50% - 4px); background: #252a34; border-radius: 8px; transition: left .22s cubic-bezier(.3,.8,.3,1); }
    .seg.audio .seg-ind { left: calc(50% + 1px); }
    .seg button { position: relative; z-index: 1; padding: 6px 0; border: 0; border-radius: 8px; background: none; color: #a7adb7; font-size: 12.5px; font-weight: 600; cursor: pointer; transition: color .18s; }
    .seg button.on { color: #fff; }

    /* quality list */
    .list { padding: 8px 6px 2px; display: flex; flex-direction: column; gap: 1px; }
    .qrow { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px; border: 0; border-radius: 9px; background: none; color: #eef0f3; cursor: pointer; text-align: left; transition: background .13s; }
    .qrow:hover { background: rgba(255,255,255,0.045); }
    .qrow:focus-visible { outline: 2px solid #c6f24d; outline-offset: -2px; }
    .qrow .radio { width: 16px; height: 16px; border-radius: 50%; border: 1.6px solid rgba(255,255,255,0.28); flex-shrink: 0; display: grid; place-items: center; transition: border-color .15s; }
    .qrow.on .radio { border-color: #c6f24d; }
    .qrow .radio::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #c6f24d; transform: scale(0); transition: transform .18s cubic-bezier(.3,.8,.3,1); }
    .qrow.on .radio::after { transform: scale(1); }
    .qrow .q { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; }
    .qrow .q strong { font-size: 13.5px; font-weight: 700; letter-spacing: 0.01em; }
    .qrow .q strong em { font-style: normal; font-size: 10px; font-weight: 700; color: #8d949f; vertical-align: 1px; margin-left: 1px; }
    .qrow .size { color: #a7adb7; font-size: 12.5px; width: 54px; text-align: right; flex-shrink: 0; }
    .qrow.on .size { color: #eef0f3; font-weight: 600; }
    .qrow.on .q { flex: 0 0 auto; }
    .qrow.on .fchips { margin-left: auto; }
    .fchips { display: flex; gap: 2px; flex-shrink: 0; position: relative; }
    .fchip-ind { position: absolute; top: 0; bottom: 0; background: rgba(198,242,77,0.13); border: 1px solid #c6f24d; border-radius: 7px; transition: left .2s cubic-bezier(.3,.8,.3,1), width .2s cubic-bezier(.3,.8,.3,1); pointer-events: none; }
    .fchips.no-trans .fchip-ind { transition: none; }
    .fchip { position: relative; z-index: 1; padding: 3px 5px; border-radius: 7px; border: 1px solid rgba(255,255,255,0.13); background: none; cursor: pointer; color: #a7adb7; font-size: 10px; font-weight: 700; letter-spacing: 0.03em; transition: border-color .13s, color .13s; }
    .fchip:hover { border-color: rgba(255,255,255,0.3); }
    .fchip.on { border-color: transparent; color: #eef0f3; }

    /* audio tab */
    .audio-view { padding: 12px 12px 4px; display: flex; flex-direction: column; gap: 12px; }
    .audio-view .group .lbl2 { color: #6f757f; font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 7px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .chip { flex: 1; min-width: 0; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 5px 6px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.13); background: #0f1116; color: #a7adb7; font-size: 11px; font-weight: 600; cursor: pointer; transition: border-color .13s, color .13s, background .13s; }
    .chip:hover { border-color: rgba(255,255,255,0.3); }
    .chip.on { background: rgba(198,242,77,0.13); border-color: #c6f24d; color: #eef0f3; }
    .lang-pref { padding: 10px; border: 1px solid rgba(198,242,77,0.22); border-radius: 10px; background: rgba(198,242,77,0.055); }
    .lang-pref p { margin: 0 0 8px; color: #a7adb7; font-size: 11.5px; line-height: 1.4; }
    .lang-pref .btn2 { width: 100%; padding: 8px 10px; }

    /* footer: download / progress / done */
    .foot { padding: 10px 12px 12px; border-top: 1px solid rgba(255,255,255,0.07); margin-top: 7px; display: flex; flex-direction: column; }
    .stage-progress .foot, .stage-done .foot { border-top: 0; margin-top: 0; }
    .go { width: 100%; padding: 11px 16px; border: 0; border-radius: 12px; cursor: pointer; background: linear-gradient(160deg,#c6f24d,#aee235); color: #17200a; display: flex; align-items: center; justify-content: space-between; gap: 10px; box-shadow: 0 10px 26px -12px rgba(198,242,77,0.55); transition: filter .15s, transform .1s; }
    .go:hover { filter: brightness(1.05); }
    .go:active { transform: translateY(1px); }
    .go:disabled { opacity: 0.5; cursor: not-allowed; filter: none; box-shadow: none; }
    .go .gl { font-weight: 800; font-size: 14px; }
    .go .gs { font-size: 11px; font-weight: 700; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .prog { display: none; flex-direction: column; gap: 9px; }
    .prog .pt { display: flex; justify-content: space-between; align-items: baseline; }
    .prog .pt strong { font-size: 13.5px; }
    .prog .pt span { color: #c6f24d; font-weight: 800; font-size: 13.5px; }
    .track { height: 8px; border-radius: 999px; background: #0f1116; border: 1px solid rgba(255,255,255,0.08); overflow: hidden; }
    .fill { height: 100%; width: 0%; border-radius: inherit; background: linear-gradient(90deg,#aee235,#d5ff63); transition: width .3s ease; }
    .pm { display: flex; justify-content: space-between; color: #a7adb7; font-size: 11px; }
    .cancel { margin-top: 2px; width: 100%; padding: 7px; border: 1px solid rgba(255,255,255,0.13); border-radius: 9px; background: none; color: #a7adb7; font-size: 11.5px; font-weight: 600; cursor: pointer; transition: border-color .13s, color .13s; }
    .cancel:hover { border-color: rgba(255,157,148,0.5); color: #ff9d94; }
    .done { display: none; align-items: center; gap: 10px; justify-content: center; padding: 6px 0; color: #eef0f3; font-weight: 700; font-size: 13.5px; }
    .done .ok { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: rgba(198,242,77,0.15); border: 1.5px solid #c6f24d; color: #c6f24d; font-size: 13px; }
    .stage-progress .go { display: none; }
    .stage-progress .prog { display: flex; }
    .stage-done .go { display: none; }
    .stage-done .done { display: flex; }

    /* message states (loading / not running / error) */
    .center { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 26px 14px; color: #a7adb7; text-align: center; }
    .spin { width: 22px; height: 22px; border: 2.5px solid rgba(255,255,255,0.15); border-top-color: #c6f24d; border-radius: 50%; animation: snagSpin 0.8s linear infinite; }
    @keyframes snagSpin { to { transform: rotate(360deg); } }
    .btn2 { padding: 9px 16px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.2); background: none; color: #eef0f3; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    .btn2:hover { border-color: #c6f24d; }
    .accent2 { background: linear-gradient(160deg, #c6f24d, #aee235); color: #17200a; border: 0; font-weight: 800; }
    .err { color: #ff9d94; font-size: 12.5px; text-align: center; }

    @media (prefers-reduced-motion: reduce) {
      .panel, .panel.closing, .spin, .seg-ind, .fchip-ind, .fill, .qrow .radio::after { animation-duration: 0.001ms !important; transition: none !important; }
    }
  `

  let panel = null // { host, shadow, root, state..., destroy() }

  function closePanel(immediate) {
    if (!panel) return
    const p = panel
    panel = null
    p.cleanup()
    if (p.returnFocus && p.returnFocus.isConnected) p.returnFocus.focus({ preventScroll: true })
    if (immediate) p.host.remove()
    else {
      p.root.classList.add('closing')
      setTimeout(() => p.host.remove(), 170)
    }
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text != null) node.textContent = text
    return node
  }

  function positionPanel(host, btn) {
    const r = btn.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.right - PANEL_WIDTH, innerWidth - PANEL_WIDTH - 8))
    const top = Math.max(8, Math.min(r.top, innerHeight - 120))
    host.style.left = left + 'px'
    host.style.top = top + 'px'
  }

  function openPanel(btn, video) {
    closePanel(true)

    const host = el('div', 'snag-panel-host')
    host.dataset.snagPanel = 'true'
    host.style.cssText = `position:fixed;z-index:2147483647;width:${PANEL_WIDTH}px;`
    const shadow = host.attachShadow({ mode: 'open' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(PANEL_CSS)
    shadow.adoptedStyleSheets = [sheet]

    const root = el('div', 'panel')
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', 'Snag download options')
    root.setAttribute('aria-modal', 'false')
    root.tabIndex = -1
    shadow.appendChild(root)
    document.documentElement.appendChild(host)
    positionPanel(host, btn)
    btn.style.visibility = 'hidden'

    const pageUrl = resolveTargetUrl(video)
    const state = {
      info: null, defaults: null, kind: 'video',
      quality: 0, container: null,
      groups: [], selectedLangs: [],
      audioLang: null, audioFmt: 'mp3',
      busy: false, jobId: null, pollTimer: null, cancelRequested: false, wakeTimer: null
    }

    // ----- dismissal wiring -----
    const onDocClick = (e) => {
      if (!panel) return
      if (state.jobId) return
      const path = e.composedPath ? e.composedPath() : []
      if (path.includes(host) || path.includes(btn)) return
      closePanel()
    }
    const onKey = (e) => { if (e.key === 'Escape') closePanel() }
    const onNav = () => closePanel(true)
    const outsideClickTimer = setTimeout(() => document.addEventListener('click', onDocClick, true), 0)
    document.addEventListener('keydown', onKey, true)
    addEventListener('popstate', onNav)
    addEventListener('yt-navigate-start', onNav, true)
    document.addEventListener('fullscreenchange', onNav)

    panel = {
      host, root, pageUrl, anchor: btn, returnFocus: btn,
      reposition: () => {
        const anchor = panel && panel.host === host ? panel.anchor : btn
        if (anchor && anchor.isConnected) positionPanel(host, anchor)
      },
      cleanup: () => {
        if (btn.isConnected) btn.style.visibility = 'visible'
        if (state.pollTimer) clearTimeout(state.pollTimer)
        if (state.wakeTimer) clearTimeout(state.wakeTimer)
        clearTimeout(outsideClickTimer)
        document.removeEventListener('click', onDocClick, true)
        document.removeEventListener('keydown', onKey, true)
        removeEventListener('popstate', onNav)
        removeEventListener('yt-navigate-start', onNav, true)
        document.removeEventListener('fullscreenchange', onNav)
      }
    }

    const LOGO = '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>'
    const noMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

    function selectedGroups() {
      return state.selectedLangs
        .map((key) => state.groups.find((g) => (g.language || '') === key))
        .filter(Boolean)
    }

    function hostLabel() {
      return HOST.replace(/^www\./, '')
    }

    // Framerate shown next to the quality only when it beats standard 30.
    function fpsForHeight(height) {
      const at = (state.info.videoFormats || []).filter((f) => (f.height || 0) === height)
      const max = at.length ? Math.max(...at.map((f) => f.fps || 0)) : 0
      return max > 30 ? Math.round(max) : 0
    }

    function buildHeights() {
      const info = state.info
      const measured = [...new Set((info.videoFormats || []).map((f) => f.height || 0).filter(Boolean))]
      const base = measured.length ? measured : (info.videoFormats || []).length ? [0] : []
      return base
        .sort((a, b) => b - a)
        .filter((height) => rowsForQuality(info, selectedGroups(), height).length > 0)
    }

    // ----- message screens (loading / not running / error) -----
    function renderMessage(children) {
      if (state.pollTimer) clearTimeout(state.pollTimer)
      root.classList.remove('stage-progress', 'stage-done')
      root.textContent = ''
      const head = el('div', 'head')
      const dot = el('span', 'dot')
      dot.innerHTML = LOGO
      const txt = el('div', 'head-txt')
      txt.appendChild(el('div', 't', 'Snag'))
      const x = el('button', 'x', '✕')
      x.type = 'button'
      x.setAttribute('aria-label', 'Close download options')
      x.addEventListener('click', () => closePanel())
      head.append(dot, txt, x)
      const body = el('div', 'center')
      for (const n of children) body.appendChild(n)
      root.append(head, body)
    }

    function renderLoading(msg) {
      renderMessage([el('span', 'spin'), el('span', null, msg)])
    }

    function renderNotRunning(hint) {
      const strong = el('strong', null, "Snag isn't running")
      const line = el('span', null, hint || 'Start it once and downloads open right here.')
      const open = el('button', 'btn2 accent2', 'Open Snag')
      open.type = 'button'
      open.addEventListener('click', () => { location.href = deepLink(pageUrl); waitForSnag() })
      renderMessage([strong, line, open])
    }

    // The deep link already hands this URL to Snag's own picker. Keep this
    // panel open only long enough to confirm startup, then get out of the way
    // so the same video cannot be enqueued from two simultaneous pickers.
    function waitForSnag() {
      renderLoading('Starting Snag…')
      const deadline = Date.now() + 30000
      const check = async () => {
        if (!panel || panel.host !== host) return
        const res = await sendMessage({ type: 'snag:ping' })
        if (!panel || panel.host !== host) return
        if (res && res.running) {
          renderMessage([
            el('strong', null, 'Opened in Snag'),
            el('span', null, 'Continue in the Snag window.')
          ])
          state.wakeTimer = setTimeout(() => closePanel(), 900)
          return
        }
        if (Date.now() >= deadline) {
          state.wakeTimer = null
          renderNotRunning("Snag didn't start — is it installed?")
          return
        }
        state.wakeTimer = setTimeout(check, 1500)
      }
      state.wakeTimer = setTimeout(check, 1500)
    }

    function renderError(message) {
      const err = el('span', 'err', message)
      const retry = el('button', 'btn2', 'Try again')
      retry.type = 'button'
      retry.addEventListener('click', start)
      const app = el('button', 'btn2', 'Open in Snag app')
      app.type = 'button'
      app.addEventListener('click', () => { location.href = deepLink(pageUrl); closePanel() })
      renderMessage([err, retry, app])
    }

    // ----- the picker itself (header stays, middle collapses on download) -----
    function renderReady() {
      root.classList.remove('stage-progress', 'stage-done')
      root.textContent = ''

      // Header: thumbnail + title + duration/site.
      const head = el('div', 'head')
      const thumb = el('span', 'thumb')
      if (state.info.thumbnail) {
        const img = document.createElement('img')
        img.alt = ''
        img.referrerPolicy = 'no-referrer'
        img.addEventListener('error', () => img.remove())
        img.src = state.info.thumbnail
        thumb.appendChild(img)
      }
      const txt = el('div', 'head-txt')
      txt.appendChild(el('div', 't', state.info.title))
      const meta = []
      if (state.info.durationString) meta.push(state.info.durationString)
      else if (state.info.isLive) meta.push('Live')
      meta.push(hostLabel())
      txt.appendChild(el('div', 'm', meta.join(' · ')))
      const x = el('button', 'x', '✕')
      x.type = 'button'
      x.title = 'Close'
      x.setAttribute('aria-label', 'Close download options')
      x.addEventListener('click', () => closePanel())
      head.append(thumb, txt, x)

      // Middle: Video/Audio toggle + the active view. Collapses while downloading.
      const mid = el('div', 'mid')
      const seg = el('div', 'seg')
      const segInd = el('span', 'seg-ind')
      const vTab = el('button', 'on', 'Video')
      vTab.type = 'button'
      const aTab = el('button', null, 'Audio')
      aTab.type = 'button'
      seg.append(segInd, vTab, aTab)
      const videoView = el('div', null)
      const audioView = el('div', 'audio-view')
      audioView.style.display = 'none'
      mid.append(seg, videoView, audioView)

      // Footer: download button, swapped for progress / done in place.
      const foot = el('div', 'foot')
      const go = el('button', 'go')
      go.type = 'button'
      go.append(el('span', 'gl', 'Download'))
      const goSub = el('span', 'gs num')
      go.append(goSub)
      const prog = el('div', 'prog')
      const pt = el('div', 'pt')
      const progLabel = el('strong', null, 'Downloading')
      const progPct = el('span', 'num', '0%')
      pt.append(progLabel, progPct)
      const track = el('div', 'track')
      const fill = el('div', 'fill')
      track.appendChild(fill)
      const pm = el('div', 'pm')
      const progSpeed = el('span', 'num')
      const progEta = el('span', 'num')
      pm.append(progSpeed, progEta)
      const cancelBtn = el('button', 'cancel', 'Cancel')
      cancelBtn.type = 'button'
      prog.append(pt, track, pm, cancelBtn)
      const done = el('div', 'done')
      done.append(el('span', 'ok', '✓'), document.createTextNode(' Saved to your folder'))
      foot.append(go, prog, done)

      root.append(head, mid, foot)

      // ---- resolution + container data for this video ----
      const heights = buildHeights()
      const rowsByHeight = new Map()
      for (const h of heights) rowsByHeight.set(h, rowsForQuality(state.info, selectedGroups(), h))

      if (!heights.includes(state.quality)) state.quality = heights[0] || 0
      ensureContainer()

      function ensureContainer() {
        const rows = rowsByHeight.get(state.quality) || []
        if (!rows.some((r) => r.container === state.container)) {
          const rec = recommendedRow(rows, selectedGroups().length >= 2, state.defaults?.preferredContainer || 'mp4')
          state.container = rec ? rec.container : (rows[0] && rows[0].container) || null
        }
      }

      function sizeText(height, container) {
        const rows = rowsByHeight.get(height) || []
        const row = rows.find((r) => r.container === container) || rows[0]
        return row ? formatBytes(row.total) : '—'
      }

      function updateGo() {
        if (state.kind === 'video') {
          const rows = rowsByHeight.get(state.quality) || []
          go.disabled = state.busy || !rows.some((r) => r.container === state.container)
          goSub.textContent =
            qualityLabel(state.quality) + ' · ' + (state.container || '').toUpperCase() +
            ' · ' + sizeText(state.quality, state.container)
        } else {
          go.disabled = state.busy || !state.groups.length
          const label = state.audioFmt === 'best' ? 'Original' : state.audioFmt.toUpperCase()
          const grp = state.groups.find((g) => (g.language || '') === state.audioLang)
          const lang = state.groups.length >= 2 && grp ? ' · ' + langLabel(grp.language) : ''
          goSub.textContent = label + lang
        }
      }

      // ---- video tab: quality rows with one travelling set of format chips ----
      function buildVideoView() {
        videoView.textContent = ''
        const list = el('div', 'list')
        videoView.appendChild(list)
        const rowEls = []
        const sizeEls = []

        const chips = el('span', 'fchips no-trans')
        const ind = el('span', 'fchip-ind')
        chips.appendChild(ind)
        let chipEls = {}

        const moveInd = () => {
          const c = chipEls[state.container]
          if (!c) { ind.style.width = '0'; return }
          ind.style.left = c.offsetLeft + 'px'
          ind.style.width = c.offsetWidth + 'px'
        }

        function buildChips(containers) {
          for (const btn2 of Object.values(chipEls)) btn2.remove()
          chipEls = {}
          for (const c of containers) {
            const b = el('button', 'fchip' + (c === state.container ? ' on' : ''), c.toUpperCase())
            b.type = 'button'
            b.title = sizeText(state.quality, c)
            b.addEventListener('click', (e) => {
              e.stopPropagation()
              if (state.container === c) return
              state.container = c
              for (const [k, elc] of Object.entries(chipEls)) elc.classList.toggle('on', k === c)
              moveInd()
              for (const s of sizeEls) s.el.textContent = sizeText(s.height, c)
              updateGo()
            })
            chipEls[c] = b
            chips.appendChild(b)
          }
        }

        const containersFor = (height) => (rowsByHeight.get(height) || []).map((r) => r.container)
        const placeChips = (height) => {
          const row = rowEls[heights.indexOf(height)]
          if (row) row.insertBefore(chips, row.querySelector('.size'))
        }

        function selectQuality(height) {
          if (state.quality === height) return
          const from = chips.getBoundingClientRect()
          rowEls[heights.indexOf(state.quality)]?.classList.remove('on')
          state.quality = height
          ensureContainer()
          rowEls[heights.indexOf(height)]?.classList.add('on')
          chips.classList.add('no-trans')
          buildChips(containersFor(height))
          placeChips(height)
          for (const s of sizeEls) s.el.textContent = sizeText(s.height, state.container)
          const to = chips.getBoundingClientRect()
          const dx = from.left - to.left
          const dy = from.top - to.top
          if (!noMotion && (dx || dy)) {
            chips.animate(
              [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
              { duration: 240, easing: 'cubic-bezier(.3,.8,.3,1)' }
            )
          }
          moveInd()
          requestAnimationFrame(() => chips.classList.remove('no-trans'))
          updateGo()
        }

        heights.forEach((height) => {
          const row = el('div', 'qrow' + (height === state.quality ? ' on' : ''))
          row.setAttribute('role', 'button')
          row.tabIndex = 0
          const strong = el('strong', null, qualityLabel(height))
          const fps = fpsForHeight(height)
          if (fps) strong.appendChild(el('em', null, String(fps)))
          const q = el('span', 'q')
          q.appendChild(strong)
          const size = el('span', 'size num', sizeText(height, state.container))
          row.append(el('span', 'radio'), q, size)
          row.addEventListener('click', () => selectQuality(height))
          row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectQuality(height) }
          })
          rowEls.push(row)
          sizeEls.push({ el: size, height })
          list.appendChild(row)
        })

        if (!heights.length) list.appendChild(el('div', 'err', 'No compatible video formats.'))

        buildChips(containersFor(state.quality))
        if (heights.length) placeChips(state.quality)
        requestAnimationFrame(() => {
          moveInd()
          requestAnimationFrame(() => chips.classList.remove('no-trans'))
        })
      }

      // ---- audio tab: output format, plus language when the video is multi-dub ----
      function buildAudioView() {
        audioView.textContent = ''
        const fgroup = el('div', 'group')
        fgroup.appendChild(el('div', 'lbl2', 'Format'))
        const fmts = el('div', 'chips')
        for (const f of ['mp3', 'm4a', 'opus', 'best']) {
          const p = el('button', 'chip' + (state.audioFmt === f ? ' on' : ''), f === 'best' ? 'Original' : f.toUpperCase())
          p.type = 'button'
          p.addEventListener('click', () => { state.audioFmt = f; buildAudioView(); updateGo() })
          fmts.appendChild(p)
        }
        fgroup.appendChild(fmts)
        audioView.appendChild(fgroup)

        if (state.groups.length >= 2) {
          const lgroup = el('div', 'group')
          lgroup.appendChild(el('div', 'lbl2', 'Language'))
          const favorites = (state.defaults?.favorites || []).map(langBase).filter(Boolean)
          if (!favorites.length) {
            const prompt = el('div', 'lang-pref')
            prompt.appendChild(el('p', null, 'Set your preferred audio language in Settings.'))
            const settings = el('button', 'btn2 accent2', 'Open Settings')
            settings.type = 'button'
            settings.addEventListener('click', async () => {
              const res = await sendMessage({ type: 'snag:open-settings' })
              if (res && res.ok) closePanel()
            })
            prompt.appendChild(settings)
            lgroup.appendChild(prompt)
          } else {
            const preferred = state.groups.filter((g) => favorites.includes(langBase(g.language)))
            const visible = preferred.length
              ? preferred
              : state.groups.filter((g) => (g.language || '') === state.audioLang).slice(0, 1)
            const langs = el('div', 'chips')
            for (const g of visible) {
              const key = g.language || ''
              const p = el('button', 'chip' + (state.audioLang === key ? ' on' : ''), langLabel(g.language) + (g.isDefault ? ' ★' : ''))
              p.type = 'button'
              p.addEventListener('click', () => { state.audioLang = key; buildAudioView(); updateGo() })
              langs.appendChild(p)
            }
            lgroup.appendChild(langs)
          }
          audioView.appendChild(lgroup)
        }
      }

      function switchTab(kind) {
        if (state.kind === kind) return
        state.kind = kind
        seg.classList.toggle('audio', kind === 'audio')
        vTab.classList.toggle('on', kind === 'video')
        aTab.classList.toggle('on', kind === 'audio')
        videoView.style.display = kind === 'video' ? '' : 'none'
        audioView.style.display = kind === 'audio' ? '' : 'none'
        updateGo()
      }
      vTab.addEventListener('click', () => switchTab('video'))
      aTab.addEventListener('click', () => switchTab('audio'))

      // ---- download → collapse the middle, run progress in the footer ----
      function collapseMid() {
        mid.style.overflow = 'hidden'
        if (noMotion) { mid.style.maxHeight = '0'; mid.style.opacity = '0'; return }
        mid.style.maxHeight = mid.scrollHeight + 'px'
        void mid.offsetHeight
        mid.style.transition = 'max-height .3s ease, opacity .2s ease'
        mid.style.maxHeight = '0'
        mid.style.opacity = '0'
      }

      function renderProgress(job) {
        const percent = Math.max(0, Math.min(100, Number(job.progress) || 0))
        progLabel.textContent =
          job.status === 'queued' ? 'Waiting…' : job.status === 'processing' ? 'Finishing…' : 'Downloading'
        progPct.textContent = Math.round(percent) + '%'
        fill.style.width = percent + '%'
        progSpeed.textContent = job.speed || job.sizeLabel || ''
        progEta.textContent = job.eta ? 'ETA ' + job.eta : ''
      }

      function renderDone() {
        state.jobId = null
        root.classList.remove('stage-progress')
        root.classList.add('stage-done')
        setTimeout(() => closePanel(), 1500)
      }

      async function pollJob() {
        if (!state.jobId || !panel || panel.host !== host) return
        const res = await sendMessage({ type: 'snag:job', jobId: state.jobId })
        if (!state.jobId || !panel || panel.host !== host) return
        const job = res.ok && res.data && res.data.job
        if (!job) {
          state.jobId = null
          renderError((res.data && res.data.error) || 'Could not read download progress.')
          return
        }
        if (job.status === 'completed') { renderDone(); return }
        if (job.status === 'error' || job.status === 'canceled') {
          state.jobId = null
          renderError(job.errorMessage || 'The download stopped.')
          return
        }
        renderProgress(job)
        state.pollTimer = setTimeout(pollJob, 500)
      }

      // Cancel puts the picker right back — a canceled download usually means
      // the wrong quality was picked, so choosing again should be one tap away.
      function cancelDownload() {
        state.cancelRequested = true
        const id = state.jobId
        state.jobId = null
        if (state.pollTimer) clearTimeout(state.pollTimer)
        if (id) void sendMessage({ type: 'snag:cancel', jobId: id })
        state.busy = false
        renderReady()
      }
      cancelBtn.addEventListener('click', cancelDownload)

      async function enqueue() {
        if (state.busy || state.jobId) return
        state.cancelRequested = false
        const info = state.info
        let request
        if (state.kind === 'video') {
          const rows = rowsByHeight.get(state.quality) || []
          const chosen = rows.find((r) => r.container === state.container)
          if (!chosen) return
          request = {
            url: info.url, title: info.title, thumbnail: info.thumbnail,
            kind: 'video',
            videoFormatId: chosen.video.formatId,
            audioFormatId: chosen.tracks[0] ? chosen.tracks[0].formatId : undefined,
            audioFormatIds: chosen.tracks.length >= 2 ? chosen.tracks.map((t) => t.formatId) : undefined,
            mergeContainer: chosen.container,
            audioLanguage: chosen.tracks[0] ? chosen.tracks[0].language : null,
            selectionLabel:
              chosen.video.qualityLabel + ' · ' + chosen.container.toUpperCase() +
              (chosen.tracks.length >= 2
                ? ' · ' + chosen.tracks.map((t) => langBase(t.language).toUpperCase()).join('+') + ' audio'
                : '')
          }
        } else {
          const group = state.groups.find((g) => (g.language || '') === state.audioLang) || state.groups[0]
          request = {
            url: info.url, title: info.title, thumbnail: info.thumbnail,
            kind: 'audio',
            audioFormatId: group && group.formats[0] ? group.formats[0].formatId : undefined,
            audioLanguage: group ? group.language : null,
            audioOutputFormat: state.audioFmt,
            selectionLabel: state.audioFmt === 'best' ? 'Original' : state.audioFmt.toUpperCase()
          }
        }

        state.busy = true
        updateGo()
        collapseMid()
        root.classList.add('stage-progress')
        renderProgress({ status: 'queued', progress: 0 })
        progLabel.textContent = 'Starting…'

        const res = await sendMessage({ type: 'snag:enqueue', request })
        state.busy = false
        if (!panel || panel.host !== host) return
        // Canceled while the job was still being created: kill it quietly; the
        // picker is already back on screen.
        if (state.cancelRequested) {
          const lateJobId = res.ok && res.data && res.data.jobId
          if (lateJobId) void sendMessage({ type: 'snag:cancel', jobId: lateJobId })
          return
        }
        if (res.ok && res.data && res.data.ok && res.data.jobId) {
          state.jobId = res.data.jobId
          void pollJob()
        } else if (res.error === 'not-running') {
          renderNotRunning()
        } else {
          renderError((res.data && res.data.error) || 'Could not add the download.')
        }
      }

      go.addEventListener('click', () => void enqueue())

      buildVideoView()
      buildAudioView()
      updateGo()
    }

    async function start() {
      renderLoading('Reading video…')
      const [defaultsRes, analyzeRes] = await Promise.all([
        sendMessage({ type: 'snag:defaults' }),
        requestAnalysis(pageUrl)
      ])
      if (!panel || panel.host !== host) return
      if (analyzeRes.error === 'not-running' || analyzeRes.error === 'not-paired' || analyzeRes.error === 'extension') {
        renderNotRunning()
        return
      }
      const data = analyzeRes.data
      if (!data || !data.ok || !data.info) {
        renderError((data && data.error) || 'Could not read this video.')
        return
      }
      state.info = data.info
      state.defaults = defaultsRes.ok ? defaultsRes.data : null
      state.groups = data.info.audioGroups || []

      // Languages that get merged as switchable tracks come from the app's
      // saved favorites — the panel no longer asks; it just applies them.
      const favs = (state.defaults?.favorites || ['en']).map(langBase)
      const picked = []
      for (const base of favs) {
        const g = state.groups.find((x) => x.language && langBase(x.language) === base)
        if (g && !picked.includes(g.language || '')) picked.push(g.language || '')
      }
      if (picked.length && !state.defaults?.multiAudioEnabled) picked.splice(1)
      if (!picked.length && state.groups.length) {
        const def = state.groups.find((g) => langBase(g.language) === 'en') ||
          state.groups.find((g) => g.isDefault) || state.groups[0]
        picked.push(def.language || '')
      }
      state.selectedLangs = picked
      state.audioLang = picked[0] ?? null

      // Default to the top resolution; pick the container Snag recommends
      // (MKV when merging 2+ languages, otherwise MP4 / the saved preference).
      const heights = buildHeights()
      state.quality = heights[0] || 0
      const topRows = rowsForQuality(state.info, selectedGroups(), state.quality)
      const rec = recommendedRow(topRows, selectedGroups().length >= 2, state.defaults?.preferredContainer || 'mp4')
      state.container = rec ? rec.container : (topRows[0] && topRows[0].container) || null

      const prefAudio = state.defaults?.preferredAudioFormat
      state.audioFmt = ['mp3', 'm4a', 'opus', 'best'].includes(prefAudio) ? prefAudio : 'mp3'

      state.kind = 'video'
      renderReady()
      requestAnimationFrame(() => root.focus({ preventScroll: true }))
    }

    void start()
  }

  // ---------- Floating button (unchanged behavior, new click target) ----------

  function makeButton(video) {
    const btn = document.createElement('button')
    btn._snagVideo = video
    btn.className = 'snag-dl-btn'
    btn.type = 'button'
    btn.title = 'Download with Snag'
    btn.setAttribute('aria-label', 'Download with Snag')
    btn.addEventListener(
      'click',
      (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (panel) {
          if (panel.anchor === btn) closePanel()
          else {
            closePanel(true)
            openPanel(btn, btn._snagVideo)
          }
        } else openPanel(btn, btn._snagVideo)
      },
      true
    )
    return btn
  }

  const MINW = MIN_WIDTH
  const MINH = MIN_HEIGHT

  function eligible(video) {
    if (disabled || document.fullscreenElement) return false
    if (!video.isConnected) return false
    const rect = video.getBoundingClientRect()
    if (rect.width < MINW || rect.height < MINH) return false
    if (rect.bottom < 0 || rect.right < 0) return false
    if (rect.top > innerHeight || rect.left > innerWidth) return false
    const style = getComputedStyle(video)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    return true
  }

  function position(video, btn) {
    const rect = video.getBoundingClientRect()
    btn.style.top = Math.min(Math.max(rect.top + INSET, 4), innerHeight - BTN_SIZE - 4) + 'px'
    btn.style.left =
      Math.min(Math.max(rect.right - BTN_SIZE - INSET, 4), innerWidth - BTN_SIZE - 4) + 'px'
  }

  let lastHref = location.href

  function refresh() {
    // SPA navigation (YouTube etc.): the dialog belongs to the previous video.
    if (location.href !== lastHref) {
      lastHref = location.href
      closePanel(true)
    }
    const videos = document.querySelectorAll('video')
    const currentVideos = new Set(videos)
    const seen = new Set()
    for (const video of videos) {
      seen.add(video)
      let btn = buttons.get(video)
      if (eligible(video)) {
        if (!btn) {
          // YouTube and other SPA players frequently replace the <video>
          // element while keeping the same visible player. Reuse the existing
          // overlay so it cannot disappear between pointer-down and click.
          const orphan = [...buttons.entries()].find(([oldVideo]) => !currentVideos.has(oldVideo))
          if (orphan) {
            const [oldVideo, oldButton] = orphan
            buttons.delete(oldVideo)
            btn = oldButton
            btn._snagVideo = video
          } else {
            btn = makeButton(video)
            document.documentElement.appendChild(btn)
          }
          buttons.set(video, btn)
        }
        btn.style.display = 'block'
        position(video, btn)
        prefetchAnalysis(video)
      } else if (btn) {
        btn.style.display = 'none'
      }
    }
    // Videos that left the DOM (SPA navigation) take their buttons with them.
    for (const [video, btn] of buttons) {
      if (!seen.has(video)) {
        if (panel && panel.anchor === btn) {
          const replacement = [...buttons.values()].find((candidate) => candidate !== btn && candidate.isConnected && candidate.style.display !== 'none')
          if (replacement) {
            panel.anchor = replacement
            panel.returnFocus = replacement
          }
        }
        btn.remove()
        buttons.delete(video)
      }
    }
    if (panel) panel.reposition()
  }

  let scheduled = false
  function schedule() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      refresh()
    })
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.disabledSites) {
      disabled = (changes.disabledSites.newValue || []).includes(HOST)
      if (disabled) closePanel(true)
      schedule()
    }
  })

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true
  })
  addEventListener('scroll', schedule, { passive: true, capture: true })
  addEventListener('resize', schedule, { passive: true })
  document.addEventListener('fullscreenchange', schedule)
  // Layout can shift without DOM mutations (player resizes, lazy CSS) — cheap heartbeat.
  setInterval(schedule, 800)

  chrome.storage.local
    .get('disabledSites')
    .then(({ disabledSites = [] }) => {
      disabled = disabledSites.includes(HOST)
      schedule()
    })
    .catch(() => schedule())
})()
