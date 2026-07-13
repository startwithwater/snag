import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  Api,
  DownloadRequest,
  Settings,
  ProgressUpdate,
  DownloadJob,
  UpdateAvailability,
  AppUpdateProgress
} from '@shared/types'

const api: Api = {
  analyze: (url: string) => ipcRenderer.invoke('analyze', url),
  enqueue: (request: DownloadRequest) => ipcRenderer.invoke('enqueue', request),
  cancel: (jobId: string) => ipcRenderer.invoke('cancel', jobId),
  retry: (jobId: string) => ipcRenderer.invoke('retry', jobId),
  clearCompleted: () => ipcRenderer.invoke('clearCompleted'),
  removeJob: (jobId: string) => ipcRenderer.invoke('removeJob', jobId),
  getJobs: () => ipcRenderer.invoke('getJobs'),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('setSettings', patch),
  pickFolder: (current?: string) => ipcRenderer.invoke('pickFolder', current),
  openPath: (target: string) => ipcRenderer.invoke('openPath', target),
  showInFolder: (target: string) => ipcRenderer.invoke('showInFolder', target),
  readClipboard: () => ipcRenderer.invoke('readClipboard'),
  getToolStatus: () => ipcRenderer.invoke('getToolStatus'),
  getAppVersion: () => ipcRenderer.invoke('getAppVersion'),
  updateYtdlp: () => ipcRenderer.invoke('updateYtdlp'),
  onProgress: (cb: (u: ProgressUpdate) => void) => {
    const listener = (_e: IpcRendererEvent, u: ProgressUpdate): void => cb(u)
    ipcRenderer.on('progress', listener)
    return () => ipcRenderer.removeListener('progress', listener)
  },
  onJobAdded: (cb: (j: DownloadJob) => void) => {
    const listener = (_e: IpcRendererEvent, j: DownloadJob): void => cb(j)
    ipcRenderer.on('jobAdded', listener)
    return () => ipcRenderer.removeListener('jobAdded', listener)
  },
  consumePendingExternalUrl: () => ipcRenderer.invoke('consumePendingExternalUrl'),
  consumePendingOpenSettings: () => ipcRenderer.invoke('consumePendingOpenSettings'),
  onExternalUrl: (cb: (url: string) => void) => {
    const listener = (_e: IpcRendererEvent, url: string): void => cb(url)
    ipcRenderer.on('externalUrl', listener)
    return () => ipcRenderer.removeListener('externalUrl', listener)
  },
  onOpenSettings: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('openSettings', listener)
    return () => ipcRenderer.removeListener('openSettings', listener)
  },
  openInMainWindow: (url: string) => ipcRenderer.invoke('openInMainWindow', url),
  installBrowserExtension: () => ipcRenderer.invoke('installBrowserExtension'),
  getBrowserExtensionPath: () => ipcRenderer.invoke('getBrowserExtensionPath'),
  getBrowserExtensionStatus: () => ipcRenderer.invoke('getBrowserExtensionStatus'),
  openBrowserExtensionSetup: () => ipcRenderer.invoke('openBrowserExtensionSetup'),
  deleteJobFile: (jobId: string) => ipcRenderer.invoke('deleteJobFile', jobId),
  deleteCompletedFiles: () => ipcRenderer.invoke('deleteCompletedFiles'),
  shareFile: (jobId: string) => ipcRenderer.invoke('shareFile', jobId),
  checkForUpdates: () => ipcRenderer.invoke('checkForUpdates'),
  dismissUpdates: () => ipcRenderer.invoke('dismissUpdates'),
  onUpdateAvailable: (cb: (u: UpdateAvailability) => void) => {
    const listener = (_e: IpcRendererEvent, u: UpdateAvailability): void => cb(u)
    ipcRenderer.on('updateAvailable', listener)
    return () => ipcRenderer.removeListener('updateAvailable', listener)
  },
  canAutoUpdate: () => ipcRenderer.invoke('canAutoUpdate'),
  downloadAppUpdate: () => ipcRenderer.invoke('downloadAppUpdate'),
  installAppUpdate: () => ipcRenderer.invoke('installAppUpdate'),
  onAppUpdateProgress: (cb: (p: AppUpdateProgress) => void) => {
    const listener = (_e: IpcRendererEvent, p: AppUpdateProgress): void => cb(p)
    ipcRenderer.on('appUpdateProgress', listener)
    return () => ipcRenderer.removeListener('appUpdateProgress', listener)
  },
  onAppUpdateDownloaded: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('appUpdateDownloaded', listener)
    return () => ipcRenderer.removeListener('appUpdateDownloaded', listener)
  },
  onAppUpdateError: (cb: (message: string) => void) => {
    const listener = (_e: IpcRendererEvent, message: string): void => cb(message)
    ipcRenderer.on('appUpdateError', listener)
    return () => ipcRenderer.removeListener('appUpdateError', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
