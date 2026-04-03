// eslint-disable-next-line @typescript-eslint/no-var-requires
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openFiles: (filters?: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('dialog:openFiles', filters),
  saveFile: (defaultName?: string) =>
    ipcRenderer.invoke('dialog:saveFile', defaultName),
  writeFile: (filePath: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('fs:writeFile', filePath, data),
  readFile: (filePath: string) =>
    ipcRenderer.invoke('fs:readFile', filePath),
  openZip: () =>
    ipcRenderer.invoke('dialog:openFiles', [{ name: 'ZIP Archive', extensions: ['zip'] }]),
  listAudioFiles: (dirPath: string) =>
    ipcRenderer.invoke('fs:listAudioFiles', dirPath),
  listDirs: (dirPath: string) =>
    ipcRenderer.invoke('fs:listDirs', dirPath),
  samplesPath: () =>
    ipcRenderer.invoke('app:samplesPath'),
})
