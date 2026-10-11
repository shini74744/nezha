export interface TerminalServer { id: number; name: string; online: boolean }
export function searchTerminalServers(rows: TerminalServer[], query: string, online: boolean) {
    const terms = query.normalize("NFKC").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    return rows.filter((row) => {
        if (online && !row.online) return false
        const text = (row.name + " " + row.id).normalize("NFKC").toLocaleLowerCase()
        return terms.every((term) => text.includes(term))
    })
}
