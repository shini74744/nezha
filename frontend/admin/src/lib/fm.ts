let receivedLength = 0
let expectedLength = 0
let root: FileSystemDirectoryHandle | undefined
let draftHandle: FileSystemFileHandle | undefined
let accessHandle: FileSystemSyncAccessHandle | undefined
let cacheName = ""
let queue = Promise.resolve()
let finished = false

async function cleanup() {
    accessHandle?.close()
    accessHandle = undefined
    if (root && cacheName) await root.removeEntry(cacheName).catch(() => undefined)
}
async function receive(operation: number, buffer: ArrayBuffer, fileName: string) {
    if (operation === 3) {
        await cleanup()
        close()
        return
    }
    if (finished) return
    if (operation === 1) {
        if (buffer.byteLength < 12) throw new Error("下载响应不完整，请重试")
        expectedLength = Number(new DataView(buffer).getBigUint64(4, false))
        if (!Number.isSafeInteger(expectedLength)) throw new Error("文件过大，无法下载")
        root = await navigator.storage.getDirectory()
        root = await root.getDirectoryHandle("nezha-downloads", { create: true })
        cacheName = crypto.randomUUID()
        draftHandle = await root.getFileHandle(cacheName, { create: true })
        accessHandle = await draftHandle.createSyncAccessHandle()
        accessHandle.truncate(0)
        buffer = buffer.slice(12)
    }
    if (!accessHandle || !draftHandle) throw new Error("下载尚未就绪，请重试")
    if (receivedLength + buffer.byteLength > expectedLength)
        throw new Error("下载数据长度不一致，请重试")
    const written = accessHandle.write(buffer, { at: receivedLength })
    if (written !== buffer.byteLength) throw new Error("浏览器存储空间不足")
    receivedLength += written
    postMessage({ type: 1, received: receivedLength, total: expectedLength })
    if (receivedLength === expectedLength) {
        accessHandle.flush()
        accessHandle.close()
        accessHandle = undefined
        finished = true
        const blob = await draftHandle.getFile()
        postMessage({ type: 2, blob, fileName })
    }
}
onmessage = (event) => {
    const { operation, arrayBuffer, fileName } = event.data
    // OPFS initialization is asynchronous; all chunks must wait for it in order.
    queue = queue
        .then(() => receive(operation, arrayBuffer, fileName))
        .catch(async (error) => {
            finished = true
            await cleanup().catch(() => undefined)
            postMessage({
                type: 0,
                error: error instanceof Error ? error.message : "下载失败，请重试",
            })
        })
}
