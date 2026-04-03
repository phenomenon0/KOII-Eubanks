import { app, BrowserWindow, ipcMain, dialog, session } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function grantMidi(ses: Electron.Session) {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'midi' || permission === 'midiSysex')
  })
  ses.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'midi' || permission === 'midiSysex'
  })
}

function createWindow() {
  // Grant on default session BEFORE window opens
  grantMidi(session.defaultSession)

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'KO Workbench',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Also grant on the window's session in case it differs
  grantMidi(win.webContents.session)

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// IPC: open file dialog
ipcMain.handle('dialog:openFiles', async (_event, filters) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: filters ?? [{ name: 'Audio', extensions: ['wav', 'mp3', 'aif', 'aiff', 'flac', 'ogg'] }],
  })
  return canceled ? [] : filePaths
})

// IPC: save file dialog
ipcMain.handle('dialog:saveFile', async (_event, defaultName) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName,
  })
  return canceled ? null : filePath
})

// IPC: write raw binary to disk (renderer is sandboxed)
ipcMain.handle('fs:writeFile', async (_event, filePath: string, buffer: ArrayBuffer) => {
  fs.writeFileSync(filePath, Buffer.from(buffer))
})

// IPC: read raw binary from disk
ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  const buf = fs.readFileSync(filePath)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
})

// IPC: list audio files in a directory
ipcMain.handle('fs:listAudioFiles', async (_event, dirPath: string) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const audioExts = new Set(['.wav', '.mp3', '.aif', '.aiff', '.flac', '.ogg'])
    const files: { name: string; path: string; size: number }[] = []
    for (const entry of entries) {
      if (entry.isFile() && audioExts.has(path.extname(entry.name).toLowerCase())) {
        const fullPath = path.join(dirPath, entry.name)
        const stat = fs.statSync(fullPath)
        files.push({ name: entry.name, path: fullPath, size: stat.size })
      }
    }
    return files
  } catch { return [] }
})

// IPC: list subdirectories (for sample packs)
ipcMain.handle('fs:listDirs', async (_event, dirPath: string) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => ({
      name: e.name,
      path: path.join(dirPath, e.name),
    }))
  } catch { return [] }
})

// IPC: get app samples path
ipcMain.handle('app:samplesPath', async () => {
  if (isDev) {
    return path.join(process.cwd(), 'samples')
  }
  return path.join(app.getPath('userData'), 'samples')
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
