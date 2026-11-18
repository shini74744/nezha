import { SESSION_EXPIRED_EVENT } from "@/api/session-renewal"
import UnsavedChanges from "@/components/UnsavedChanges"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { Link, RouterProvider, createMemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

function Editor({ busy = false }: { busy?: boolean }) {
    const [text, setText] = useState("")
    return (
        <>
            <UnsavedChanges dirty={!!text} busy={busy} />
            <input aria-label="draft" value={text} onChange={(e) => setText(e.target.value)} />
            <Link to="/next">next</Link>
            <Link to="/dashboard/login">login</Link>
        </>
    )
}
function show(busy = false) {
    const router = createMemoryRouter([
        { path: "/", element: <Editor busy={busy} /> },
        { path: "/next", element: <p>destination</p> },
        { path: "/dashboard/login", element: <p>login destination</p> },
    ])
    render(<RouterProvider router={router} />)
    return router
}
describe("unsaved changes guard", () => {
    it("keeps or discards draft through router confirmation", async () => {
        show()
        fireEvent.change(screen.getByLabelText("draft"), { target: { value: "draft" } })
        fireEvent.click(screen.getByText("next"))
        await screen.findByRole("dialog")
        fireEvent.click(screen.getByRole("button", { name: "继续编辑" }))
        expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("draft")
        fireEvent.click(screen.getByText("next"))
        await screen.findByRole("dialog")
        fireEvent.click(screen.getByRole("button", { name: "放弃修改并离开" }))
        await screen.findByText("destination")
    })
    it("does not block expiry or explicit login", async () => {
        const router = show()
        fireEvent.change(screen.getByLabelText("draft"), { target: { value: "draft" } })
        await act(async () => {
            window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
            await router.navigate("/next")
        })
        await screen.findByText("destination")
        expect(screen.queryByRole("dialog")).toBeNull()
    })
    it("releases beforeunload listeners on unmount", async () => {
        const router = show()
        fireEvent.change(screen.getByLabelText("draft"), { target: { value: "draft" } })
        const event = new Event("beforeunload", { cancelable: true })
        window.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        await act(async () => {
            await router.navigate("/dashboard/login")
        })
        await screen.findByText("login destination")
        const after = new Event("beforeunload", { cancelable: true })
        window.dispatchEvent(after)
        expect(after.defaultPrevented).toBe(false)
    })
    it("blocks navigation while saving without allowing discard", async () => {
        const router = show(true)
        fireEvent.click(screen.getByText("next"))
        await waitFor(() =>
            expect(
                router.state.blockers.size === 0 ||
                    [...router.state.blockers.values()].every((b) => b.state === "unblocked"),
            ).toBe(true),
        )
        expect(router.state.location.pathname).toBe("/")
        expect(screen.queryByRole("dialog")).toBeNull()
    })
})
