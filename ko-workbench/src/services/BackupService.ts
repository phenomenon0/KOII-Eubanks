// ────────────────────────────────────────────────────────────
// KO Workbench — Backup & Restore Service
// Downloads/uploads the EP-133 filesystem into/from ZIP archives
// ────────────────────────────────────────────────────────────

import JSZip from 'jszip'
import type { EP133FileSystem, FSNode } from '../protocol/filesystem'
import type { DeviceInfo, SoundMeta } from '../protocol/types'
import type { AppAction, BackupProgress } from '../store'

type Dispatch = (action: AppAction) => void

declare global {
  interface Window {
    electronAPI: {
      openFiles: (filters?: { name: string; extensions: string[] }[]) => Promise<string[]>
      saveFile: (defaultName?: string) => Promise<string | null>
      writeFile: (path: string, data: ArrayBuffer) => Promise<void>
      readFile: (path: string) => Promise<ArrayBuffer>
      openZip: () => Promise<string[]>
    }
  }
}

interface BackupMeta {
  version: 1
  date: string
  device: string
  firmware: string
  projectsOnly: boolean
}

export class BackupService {
  constructor(
    private fs: EP133FileSystem,
    private dispatch: Dispatch,
    private deviceInfo: DeviceInfo,
  ) {}

  // ── Backup (full or projects-only) ─────────────────────────

  async createBackup(opts: { projectsOnly: boolean }): Promise<void> {
    try {
      this.report({ operation: 'backup', phase: 'scanning', currentFile: '', fileIndex: 0, fileCount: 0, bytesTransferred: 0, bytesTotal: 0 })

      // Collect all file nodes from the relevant roots
      const rootPaths = opts.projectsOnly ? ['/projects'] : ['/sounds', '/projects']
      const files = await this.collectFiles(rootPaths)

      if (files.length === 0) {
        this.report({ phase: 'done', fileCount: 0 })
        return
      }

      const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
      this.report({ phase: 'transferring', fileCount: files.length, bytesTotal: totalBytes })

      // Download each file and pack into ZIP
      const zip = new JSZip()
      let bytesTransferred = 0

      for (let i = 0; i < files.length; i++) {
        const node = files[i]
        this.report({ currentFile: node.path, fileIndex: i + 1 })

        const data = await this.fs.get(node.nodeId)
        let meta: SoundMeta = {}
        try { meta = await this.fs.getMetadata(node.nodeId) } catch { /* no metadata */ }

        // Strip leading slash for ZIP paths
        const zipPath = node.path.slice(1)
        zip.file(zipPath, data)
        if (Object.keys(meta).length > 0) {
          zip.file(zipPath + '.meta', JSON.stringify(meta, null, 2))
        }

        bytesTransferred += node.size
        this.report({ bytesTransferred })
      }

      // Add archive metadata
      const archiveMeta: BackupMeta = {
        version: 1,
        date: new Date().toISOString(),
        device: this.deviceInfo.name,
        firmware: this.deviceInfo.firmware,
        projectsOnly: opts.projectsOnly,
      }
      zip.file('meta.json', JSON.stringify(archiveMeta, null, 2))

      // Generate ZIP
      this.report({ phase: 'packing', currentFile: 'Generating archive...' })
      const buffer = await zip.generateAsync({ type: 'arraybuffer' })

      // Prompt user for save location
      const dateStr = new Date().toISOString().slice(0, 10)
      const suffix = opts.projectsOnly ? '_projects' : ''
      const defaultName = `EP133_backup${suffix}_${dateStr}.zip`
      const savePath = await window.electronAPI.saveFile(defaultName)
      if (!savePath) {
        this.dispatch({ type: 'BACKUP_PROGRESS', progress: null })
        return
      }

      await window.electronAPI.writeFile(savePath, buffer)
      this.report({ phase: 'done', currentFile: savePath })
    } catch (e) {
      this.report({ phase: 'error', errorMessage: String(e) })
      throw e
    }
  }

  // ── Per-project backup ─────────────────────────────────────

  async createProjectBackup(projectPath: string): Promise<void> {
    try {
      this.report({ operation: 'backup', phase: 'scanning', currentFile: '', fileIndex: 0, fileCount: 0, bytesTransferred: 0, bytesTotal: 0 })

      const files = await this.collectFiles([projectPath])
      if (files.length === 0) {
        this.report({ phase: 'done', fileCount: 0 })
        return
      }

      const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
      this.report({ phase: 'transferring', fileCount: files.length, bytesTotal: totalBytes })

      const zip = new JSZip()
      let bytesTransferred = 0

      for (let i = 0; i < files.length; i++) {
        const node = files[i]
        this.report({ currentFile: node.path, fileIndex: i + 1 })

        const data = await this.fs.get(node.nodeId)
        let meta: SoundMeta = {}
        try { meta = await this.fs.getMetadata(node.nodeId) } catch { /* no metadata */ }

        const zipPath = node.path.slice(1)
        zip.file(zipPath, data)
        if (Object.keys(meta).length > 0) {
          zip.file(zipPath + '.meta', JSON.stringify(meta, null, 2))
        }

        bytesTransferred += node.size
        this.report({ bytesTransferred })
      }

      const archiveMeta: BackupMeta = {
        version: 1,
        date: new Date().toISOString(),
        device: this.deviceInfo.name,
        firmware: this.deviceInfo.firmware,
        projectsOnly: false,
      }
      zip.file('meta.json', JSON.stringify(archiveMeta, null, 2))

      this.report({ phase: 'packing', currentFile: 'Generating archive...' })
      const buffer = await zip.generateAsync({ type: 'arraybuffer' })

      const projectName = projectPath.split('/').pop() ?? 'project'
      const dateStr = new Date().toISOString().slice(0, 10)
      const savePath = await window.electronAPI.saveFile(`EP133_${projectName}_${dateStr}.zip`)
      if (!savePath) {
        this.dispatch({ type: 'BACKUP_PROGRESS', progress: null })
        return
      }

      await window.electronAPI.writeFile(savePath, buffer)
      this.report({ phase: 'done', currentFile: savePath })
    } catch (e) {
      this.report({ phase: 'error', errorMessage: String(e) })
      throw e
    }
  }

  // ── Restore from ZIP ──────────────────────────────────────

  async restoreFromZip(): Promise<void> {
    try {
      // Prompt user to pick a ZIP
      const paths = await window.electronAPI.openZip()
      if (!paths || paths.length === 0) return

      this.report({ operation: 'restore', phase: 'unpacking', currentFile: 'Reading archive...', fileIndex: 0, fileCount: 0, bytesTransferred: 0, bytesTotal: 0 })

      const buffer = await window.electronAPI.readFile(paths[0])
      const zip = await JSZip.loadAsync(buffer)

      // Read and validate meta.json
      const metaFile = zip.file('meta.json')
      if (!metaFile) throw new Error('Invalid backup: missing meta.json')
      const archiveMeta = JSON.parse(await metaFile.async('text')) as BackupMeta
      if (archiveMeta.version !== 1) throw new Error(`Unsupported backup version: ${archiveMeta.version}`)

      // Enumerate data files (skip meta.json and .meta sidecars)
      const dataFiles = Object.keys(zip.files).filter(
        name => !zip.files[name].dir && name !== 'meta.json' && !name.endsWith('.meta')
      )

      if (dataFiles.length === 0) {
        this.report({ phase: 'done', fileCount: 0 })
        return
      }

      this.report({ phase: 'scanning', fileCount: dataFiles.length, currentFile: 'Resolving device paths...' })

      // Pre-compute total bytes
      let totalBytes = 0
      for (const name of dataFiles) {
        const entry = zip.file(name)
        if (entry) {
          const data = await entry.async('uint8array')
          totalBytes += data.length
        }
      }

      this.report({ phase: 'transferring', bytesTotal: totalBytes })

      const errors: string[] = []
      let bytesTransferred = 0

      for (let i = 0; i < dataFiles.length; i++) {
        const zipPath = dataFiles[i]
        const devicePath = '/' + zipPath
        this.report({ currentFile: devicePath, fileIndex: i + 1 })

        try {
          const entry = zip.file(zipPath)!
          const data = await entry.async('uint8array')

          // Resolve parent directory
          const parts = zipPath.split('/')
          const fileName = parts.pop()!
          const parentDevicePath = '/' + parts.join('/')
          const parentId = await this.fs.getNodeId(parentDevicePath)

          // Check if file already exists (for overwrite)
          const siblings = await this.fs.list(parentId, parentDevicePath)
          const existing = siblings.find(n => n.name === fileName && n.type === 'file')

          // Read metadata sidecar if present
          let meta: SoundMeta | null = null
          const metaSidecar = zip.file(zipPath + '.meta')
          if (metaSidecar) {
            try { meta = JSON.parse(await metaSidecar.async('text')) } catch { /* skip bad meta */ }
          }

          await this.fs.put(data, fileName, parentId, existing?.nodeId ?? null, meta)
          bytesTransferred += data.length
          this.report({ bytesTransferred })
        } catch (e) {
          errors.push(`${devicePath}: ${e}`)
          console.error(`Restore failed for ${devicePath}:`, e)
        }
      }

      if (errors.length > 0) {
        this.report({ phase: 'error', errorMessage: `Restored with ${errors.length} error(s):\n${errors.join('\n')}` })
      } else {
        this.report({ phase: 'done' })
      }
    } catch (e) {
      this.report({ phase: 'error', errorMessage: String(e) })
      throw e
    }
  }

  // ── Restore single project from ZIP ────────────────────────

  async restoreProject(targetProjectPath: string): Promise<void> {
    try {
      const paths = await window.electronAPI.openZip()
      if (!paths || paths.length === 0) return

      this.report({ operation: 'restore', phase: 'unpacking', currentFile: 'Reading archive...', fileIndex: 0, fileCount: 0, bytesTransferred: 0, bytesTotal: 0 })

      const buffer = await window.electronAPI.readFile(paths[0])
      const zip = await JSZip.loadAsync(buffer)

      // Find project files in the ZIP — match any projects/PXX/ prefix
      const allFiles = Object.keys(zip.files).filter(
        name => !zip.files[name].dir && name !== 'meta.json' && !name.endsWith('.meta')
      )
      const projectFiles = allFiles.filter(name => name.startsWith('projects/'))
      if (projectFiles.length === 0) {
        this.report({ phase: 'error', errorMessage: 'No project data found in archive' })
        return
      }

      // Determine the source project prefix from the ZIP (first project dir found)
      const sourcePrefix = projectFiles[0].split('/').slice(0, 2).join('/')

      this.report({ phase: 'transferring', fileCount: projectFiles.length, bytesTotal: 0 })

      const targetPrefix = targetProjectPath.slice(1) // strip leading /
      const errors: string[] = []

      for (let i = 0; i < projectFiles.length; i++) {
        const zipPath = projectFiles[i]
        // Remap: replace source project prefix with target
        const remapped = zipPath.replace(sourcePrefix, targetPrefix)
        const devicePath = '/' + remapped
        this.report({ currentFile: devicePath, fileIndex: i + 1 })

        try {
          const entry = zip.file(zipPath)!
          const data = await entry.async('uint8array')

          const parts = remapped.split('/')
          const fileName = parts.pop()!
          const parentDevicePath = '/' + parts.join('/')
          const parentId = await this.fs.getNodeId(parentDevicePath)

          const siblings = await this.fs.list(parentId, parentDevicePath)
          const existing = siblings.find(n => n.name === fileName && n.type === 'file')

          let meta: SoundMeta | null = null
          const metaSidecar = zip.file(zipPath + '.meta')
          if (metaSidecar) {
            try { meta = JSON.parse(await metaSidecar.async('text')) } catch { /* skip */ }
          }

          await this.fs.put(data, fileName, parentId, existing?.nodeId ?? null, meta)
        } catch (e) {
          errors.push(`${devicePath}: ${e}`)
          console.error(`Restore failed for ${devicePath}:`, e)
        }
      }

      if (errors.length > 0) {
        this.report({ phase: 'error', errorMessage: `Restored with ${errors.length} error(s):\n${errors.join('\n')}` })
      } else {
        this.report({ phase: 'done' })
      }
    } catch (e) {
      this.report({ phase: 'error', errorMessage: String(e) })
      throw e
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  private async collectFiles(rootPaths: string[]): Promise<FSNode[]> {
    const files: FSNode[] = []
    for (const rootPath of rootPaths) {
      const rootId = await this.fs.getNodeId(rootPath)
      const nodes = await this.fs.tree(rootId)
      // Assign correct paths (tree() walks from rootId but paths are relative to it)
      // tree() already assigns full paths via list(), so filter to files only
      for (const node of nodes) {
        if (node.type === 'file') {
          files.push(node)
        }
      }
    }
    return files
  }

  private currentProgress: BackupProgress = {
    operation: 'backup',
    phase: 'scanning',
    currentFile: '',
    fileIndex: 0,
    fileCount: 0,
    bytesTransferred: 0,
    bytesTotal: 0,
  }

  private report(update: Partial<BackupProgress>): void {
    this.currentProgress = { ...this.currentProgress, ...update }
    this.dispatch({ type: 'BACKUP_PROGRESS', progress: { ...this.currentProgress } })
  }
}
