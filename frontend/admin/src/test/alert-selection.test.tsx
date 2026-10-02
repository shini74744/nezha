import { useState } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { AlertSelection } from "@/components/alert-condition-editor"

afterEach(cleanup)
function Editor() {
    const [value, setValue] = useState(["1", "3"])
    return <AlertSelection title="选择排除服务器" value={value} onChange={setValue}
        options={[{ id: 1, name: "一号" }, { id: 2, name: "二号" }, { id: 3, name: "三号" }]} />
}
it("keeps the count in sync even if browser tooling normalizes summary text nodes", () => {
    const { container } = render(<Editor />)
    const summary = container.querySelector("summary")!
    // Browser translation/DOM tools can merge adjacent text nodes, detaching React's count node.
    summary.normalize()
    fireEvent.click(screen.getByLabelText("二号 #2"))
    expect(container.querySelector("p")!.textContent).toContain("二号 #2")
    expect(summary.textContent).toBe("选择排除服务器 · 已选 3 项")
    summary.normalize()
    fireEvent.click(screen.getByLabelText("一号 #1"))
    expect(summary.textContent).toBe("选择排除服务器 · 已选 2 项")
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "二号" } })
    expect(summary.textContent).toBe("选择排除服务器 · 已选 2 项")
})
