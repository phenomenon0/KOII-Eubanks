// ────────────────────────────────────────────────────────────
// KO Workbench — EP-133 filesystem over SysEx
// Formats extracted directly from ep_133_sample_tool bundle
// ────────────────────────────────────────────────────────────

import { SysexClient } from './sysex'
import {
  TE_CMD, TE_FILE, TE_FILE_PUT, TE_FILE_GET, TE_FILE_META,
  TE_FILE_TYPE, TE_FILE_CAP, TE_PLAYBACK,
  FileNode, SoundMeta, ProgressCallback,
} from './types'

// ─── Helpers ──────────────────────────────────────────────────

function parseNullTerminatedString(data: Uint8Array, offset: number): string {
  let end = offset
  while (end < data.length && data[end] !== 0) end++
  return new TextDecoder().decode(data.slice(offset, end))
}

function writeNullTerminatedString(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  view.setUint8(offset + s.length, 0)
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}

// ─── Request/Response wire types (matching original tool exactly) ─────

class FileInitRequest {
  // [INIT(1), flags(1), maxResponseLength(4BE)]
  constructor(private maxResponseLength = 4 * 1024 * 1024, private flags = 1) {}
  bytes(): Uint8Array {
    const a = new Uint8Array(6)
    const v = new DataView(a.buffer)
    v.setUint8(0, TE_FILE.INIT)
    v.setUint8(1, this.flags)
    v.setUint32(2, this.maxResponseLength)
    return a
  }
}

class FileListRequest {
  // [LIST(4), page(2BE), nodeId(2BE)]
  constructor(private page: number, private nodeId: number) {}
  bytes(): Uint8Array {
    const a = new Uint8Array(5)
    const v = new DataView(a.buffer)
    v.setUint8(0, TE_FILE.LIST)
    v.setUint16(1, this.page)
    v.setUint16(3, this.nodeId)
    return a
  }
}

class FileInfoRequest {
  // [INFO(11), fileId(2BE)]
  constructor(private fileId: number) {}
  bytes(): Uint8Array {
    const a = new Uint8Array(3)
    const v = new DataView(a.buffer)
    v.setUint8(0, TE_FILE.INFO)
    v.setUint16(1, this.fileId)
    return a
  }
}

class FilePutInitRequest {
  // [PUT(2), INIT(0), flags(1), fileId(2BE), parentId(2BE), fileSize(4BE), filename\0, metadata\0]
  constructor(
    private fileId: number,
    private parentId: number,
    private flags: number,
    private fileSize: number,
    private filename: string,
    private metadata: string | null = null,
  ) {
    this.filename = filename.slice(0, 54)
  }
  bytes(): Uint8Array {
    const nameLen = this.filename.length + 1  // +1 for null
    const base = new Uint8Array(11 + nameLen)
    const v = new DataView(base.buffer)
    v.setUint8(0, TE_FILE.PUT)
    v.setUint8(1, TE_FILE_PUT.INIT)
    v.setUint8(2, this.flags)
    v.setUint16(3, this.fileId)
    v.setUint16(5, this.parentId)
    v.setUint32(7, this.fileSize)
    writeNullTerminatedString(v, 11, this.filename)

    if (this.metadata != null) {
      const metaBytes = new Uint8Array(this.metadata.length + 1)
      const mv = new DataView(metaBytes.buffer)
      writeNullTerminatedString(mv, 0, this.metadata)
      return concatBytes(base, metaBytes)
    }
    return base
  }
}

class FilePutDataRequest {
  // [PUT(2), DATA(1), page(2BE), ...data]
  constructor(private page: number, private data: Uint8Array) {}
  bytes(): Uint8Array {
    const a = new Uint8Array(4 + this.data.length)
    const v = new DataView(a.buffer)
    v.setUint8(0, TE_FILE.PUT)
    v.setUint8(1, TE_FILE_PUT.DATA)
    v.setUint16(2, this.page)
    a.set(this.data, 4)
    return a
  }
}

class FileGetInitRequest {
  // [GET(3), INIT(0), fileId(2BE), offset(4BE)]
  constructor(private fileId: number, private offset = 0) {}
  bytes(): Uint8Array {
    const a = new Uint8Array(8)
    const v = new DataView(a.buffer)
    v.setUint8(0, TE_FILE.GET)
    v.setUint8(1, TE_FILE_GET.INIT)
    v.setUint16(2, this.fileId)
    v.setUint32(4, this.offset)
    return a
  }
}

class FileGetDataRequest {
  // [GET(3), DATA(1), page(2BE)]
  constructor(private page: number) {}
  bytes(): Uint8Array {
    const a = new Uint8Array(4)
    const v = new DataView(a.buffer)
    v.setUint8(0, TE_FILE.GET)
    v.setUint8(1, TE_FILE_GET.DATA)
    v.setUint16(2, this.page)
    return a
  }
}

class FileDeleteRequest {
  // [DELETE(6), fileId(2BE)]
  constructor(private fileId: number) {}
  bytes(): Uint8Array {
    const a = new Uint8Array(3)
    const v = new DataView(a.buffer)
    v.setUint8(0, TE_FILE.DELETE)
    v.setUint16(1, this.fileId)
    return a
  }
}

class FileMetadataGetRequest {
  // [METADATA(7), GET(2), fileId(2BE)]
  constructor(private fileId: number) {}
  bytes(): Uint8Array {
    const a = new Uint8Array(4)
    const v = new DataView(a.buffer)
    v.setUint8(0, TE_FILE.METADATA)
    v.setUint8(1, TE_FILE_META.GET)
    v.setUint16(2, this.fileId)
    return a
  }
}

class FileMetadataSetRequest {
  // [METADATA(7), SET(1), fileId(2BE), json\0]
  constructor(private fileId: number, private json: string) {}
  bytes(): Uint8Array {
    const a = new Uint8Array(4 + this.json.length + 1)
    const v = new DataView(a.buffer)
    v.setUint8(0, TE_FILE.METADATA)
    v.setUint8(1, TE_FILE_META.SET)
    v.setUint16(2, this.fileId)
    writeNullTerminatedString(v, 4, this.json)
    return a
  }
}

class FilePlaybackRequest {
  // [PLAYBACK(5), action(1), fileId(2BE), offset(4BE), length(4BE)]
  constructor(private fileId: number, private action: number, private offset = 0, private length = 0) {}
  bytes(): Uint8Array {
    const a = new Uint8Array(12)
    const v = new DataView(a.buffer)
    v.setUint8(0, TE_FILE.PLAYBACK)
    v.setUint8(1, this.action)
    v.setUint16(2, this.fileId)
    v.setUint32(4, this.offset)
    v.setUint32(8, this.length)
    return a
  }
}

// ─── FileSystem ────────────────────────────────────────────────

export interface FSNode {
  nodeId: number
  parentId: number
  name: string
  flags: number
  size: number
  type: 'file' | 'dir'
  path: string
}

export class EP133FileSystem {
  private chunkSize = 4096  // default; overwritten by INIT response
  private pathCache = new Map<string, number>()   // path → nodeId

  constructor(
    private client: SysexClient,
    private identityCode: number,
  ) {}

  private send(req: { bytes(): Uint8Array }, timeoutMs = 15_000) {
    return this.client.sendAndReceive(this.identityCode, TE_CMD.FILE, req.bytes(), timeoutMs)
  }

  // ── INIT ──────────────────────────────────────────────────

  async init(): Promise<void> {
    const resp = await this.send(new FileInitRequest(), 15_000)
    // chunkSize = resp.data[1..4] big-endian
    if (resp.data.length >= 5) {
      const v = new DataView(resp.data.buffer, resp.data.byteOffset)
      this.chunkSize = v.getUint32(1)
    }
    console.log('[FS] init ok, chunkSize=', this.chunkSize)
  }

  // ── LIST (paginated) ──────────────────────────────────────

  async *iterNodes(nodeId: number): AsyncGenerator<FSNode> {
    let page = 0
    for (;;) {
      const resp = await this.send(new FileListRequest(page, nodeId))
      if (resp.data.length <= 2) break

      const currentPage = (resp.data[0] << 8) | resp.data[1]
      if (currentPage !== page) throw new Error(`LIST: unexpected page ${currentPage}, expected ${page}`)
      page++

      const entries = resp.data.slice(2)
      let offset = 0
      while (offset + 7 < entries.length) {
        const nid    = (entries[offset] << 8) | entries[offset + 1]
        const flags  = entries[offset + 2]
        const size   = (entries[offset+3] << 24) | (entries[offset+4] << 16) | (entries[offset+5] << 8) | entries[offset+6]
        const name   = parseNullTerminatedString(entries, offset + 7)
        const entLen = 7 + name.length
        offset += entLen + 1  // +1 for null terminator

        const type: 'file' | 'dir' = (flags & TE_FILE_TYPE.DIR) ? 'dir' : 'file'
        yield { nodeId: nid, parentId: nodeId, name, flags, size, type, path: '' }
      }
    }
  }

  async list(nodeId: number, parentPath = ''): Promise<FSNode[]> {
    const nodes: FSNode[] = []
    for await (const n of this.iterNodes(nodeId)) {
      n.path = parentPath ? `${parentPath}/${n.name}` : `/${n.name}`
      nodes.push(n)
    }
    return nodes
  }

  // ── Path → NodeId ─────────────────────────────────────────

  async getNodeId(path: string): Promise<number> {
    if (this.pathCache.has(path)) return this.pathCache.get(path)!

    const parts = path.replace(/^\//, '').split('/').filter(Boolean)
    let currentId = 0  // root

    for (const part of parts) {
      const children = await this.list(currentId)
      const found = children.find(n => n.name === part)
      if (!found) throw new Error(`Path not found: ${path} (missing '${part}')`)
      currentId = found.nodeId
    }

    this.pathCache.set(path, currentId)
    return currentId
  }

  // ── GET (download) ────────────────────────────────────────

  async *iterGet(nodeId: number, onProgress?: ProgressCallback): AsyncGenerator<Uint8Array> {
    // Init
    const initResp = await this.send(new FileGetInitRequest(nodeId), 15_000)
    const v = new DataView(initResp.data.buffer, initResp.data.byteOffset)
    const totalSize = v.getUint32(3)   // data[3..6] = fileSize
    let received = 0
    let page = 0

    // Fetch data pages
    for (;;) {
      const dataResp = await this.send(new FileGetDataRequest(page), 15_000)
      const dv = new DataView(dataResp.data.buffer, dataResp.data.byteOffset)
      const respPage = dv.getUint16(0)
      const chunk = dataResp.data.slice(2)

      if (chunk.length === 0) break
      if (respPage !== page) throw new Error(`GET: unexpected page ${respPage}`)

      yield chunk
      received += chunk.length
      onProgress?.(received, totalSize, 'downloading')
      page++

      if (received >= totalSize) break
    }
  }

  async get(nodeId: number, onProgress?: ProgressCallback): Promise<Uint8Array> {
    const chunks: Uint8Array[] = []
    for await (const chunk of this.iterGet(nodeId, onProgress)) {
      chunks.push(chunk)
    }
    const total = chunks.reduce((s, c) => s + c.length, 0)
    const out = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { out.set(c, off); off += c.length }
    return out
  }

  // ── PUT (upload) ──────────────────────────────────────────

  async put(
    data: Uint8Array,
    name: string,
    parentId: number,
    existingNodeId: number | null = null,   // null = create new (fileId=0xFFFF)
    metadata: SoundMeta | null = null,
    onProgress?: ProgressCallback,
    capabilities = TE_FILE_CAP.READ | TE_FILE_CAP.WRITE | TE_FILE_CAP.DELETE | TE_FILE_CAP.PLAYBACK,
  ): Promise<number> {
    const fileId = existingNodeId ?? 0xFFFF
    const flags = capabilities | TE_FILE_TYPE.FILE

    let metaJson: string | null = null
    if (metadata) {
      metaJson = JSON.stringify(metadata)
    }

    // PUT INIT
    const initReq = new FilePutInitRequest(fileId, parentId, flags, data.length, name, metaJson)
    const initResp = await this.send(initReq, 20_000)
    const assignedNodeId = (initResp.data[0] << 8) | initResp.data[1]

    // PUT DATA chunks
    const chunkSize = this.chunkSize || 4096
    let offset = 0, page = 0
    while (offset < data.length) {
      const chunk = data.slice(offset, offset + chunkSize)
      await this.send(new FilePutDataRequest(page, chunk), 15_000)
      offset += chunk.length
      page++
      onProgress?.(offset, data.length, 'uploading')
    }

    return assignedNodeId
  }

  // ── DELETE ────────────────────────────────────────────────

  async delete(nodeId: number): Promise<void> {
    await this.send(new FileDeleteRequest(nodeId))
  }

  // ── METADATA ─────────────────────────────────────────────

  async getMetadata(nodeId: number): Promise<SoundMeta> {
    const resp = await this.send(new FileMetadataGetRequest(nodeId))
    try {
      return JSON.parse(parseNullTerminatedString(resp.data, 0)) as SoundMeta
    } catch {
      return {}
    }
  }

  async setMetadata(nodeId: number, meta: SoundMeta): Promise<void> {
    await this.send(new FileMetadataSetRequest(nodeId, JSON.stringify(meta)))
  }

  // ── PLAYBACK ─────────────────────────────────────────────

  async startPlayback(nodeId: number, offsetMs = 0, lengthMs = 0): Promise<void> {
    await this.send(new FilePlaybackRequest(nodeId, TE_PLAYBACK.START, offsetMs, lengthMs), 5_000)
  }

  async stopPlayback(nodeId: number): Promise<void> {
    await this.send(new FilePlaybackRequest(nodeId, TE_PLAYBACK.STOP), 5_000)
  }

  // ── Tree walk ─────────────────────────────────────────────

  async tree(rootId = 0): Promise<FSNode[]> {
    const walk = async (nodeId: number, parentPath: string): Promise<FSNode[]> => {
      const result: FSNode[] = []
      const children = await this.list(nodeId, parentPath)
      for (const node of children) {
        result.push(node)
        if (node.type === 'dir') {
          result.push(...await walk(node.nodeId, node.path))
        }
      }
      return result
    }
    return walk(rootId, '')
  }
}
