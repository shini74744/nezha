import { NotificationURLCopyButton } from "@/components/notification-url-copy-button"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
    read: vi.fn(),
    copy: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}))
vi.mock("@/api/notification", () => ({ getNotificationEditor: mocks.read }))
vi.mock("@/lib/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/utils")>()),
    copyToClipboard: mocks.copy,
}))
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }))

const completeURL =
    "https://api.telegram.org/bot123:fixture_token/sendMessage?chat_id=-100123&text=#NEZHA#"

const button = () => screen.getByRole("button", { name: "复制完整通知地址" }) as HTMLButtonElement

beforeEach(() => {
    vi.resetAllMocks()
    mocks.read.mockResolvedValue({ url: completeURL })
    mocks.copy.mockResolvedValue(undefined)
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

describe("notification URL copy", () => {
    it("does not preload credentials when the list renders", () => {
        render(<NotificationURLCopyButton notificationId={7} />)
        expect(mocks.read).not.toHaveBeenCalled()
        expect(mocks.copy).not.toHaveBeenCalled()
        expect(button().title).toContain("Bot Token")
        expect(button().disabled).toBe(false)
    })

    it("copies the full saved URL and token without changing query placeholders", async () => {
        render(<NotificationURLCopyButton notificationId={7} />)
        fireEvent.click(button())
        await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("复制成功"))
        expect(mocks.read).toHaveBeenCalledExactlyOnceWith(7)
        expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(completeURL)
        expect(mocks.error).not.toHaveBeenCalled()
        expect(document.body.textContent).not.toContain("fixture_token")
        expect(button().disabled).toBe(false)
    })

    it("waits for the clipboard and prevents duplicate clicks while pending", async () => {
        let finish!: () => void
        mocks.copy.mockReturnValue(
            new Promise<void>((resolve) => {
                finish = resolve
            }),
        )
        render(<NotificationURLCopyButton notificationId={7} />)
        fireEvent.click(button())
        await waitFor(() => expect(mocks.copy).toHaveBeenCalledTimes(1))
        fireEvent.click(button())
        expect(button().disabled).toBe(true)
        expect(button().getAttribute("aria-busy")).toBe("true")
        expect(mocks.success).not.toHaveBeenCalled()
        expect(mocks.read).toHaveBeenCalledTimes(1)
        await act(async () => finish())
        expect(mocks.success).toHaveBeenCalledTimes(1)
        expect(button().disabled).toBe(false)
    })

    it.each(["permission denied", "network unavailable", "notification not found"])(
        "does not copy or leak server errors when reading fails: %s",
        async (message) => {
            mocks.read.mockRejectedValue(new Error(message + " " + completeURL))
            render(<NotificationURLCopyButton notificationId={7} />)
            fireEvent.click(button())
            await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1))
            expect(mocks.copy).not.toHaveBeenCalled()
            expect(mocks.success).not.toHaveBeenCalled()
            expect(mocks.error.mock.calls[0][0]).not.toContain("fixture_token")
            expect(button().disabled).toBe(false)
        },
    )

    it("reports an actually unconfigured URL without copying empty text", async () => {
        mocks.read.mockResolvedValue({ url: "" })
        render(<NotificationURLCopyButton notificationId={7} />)
        fireEvent.click(button())
        await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("该通知尚未配置 URL"))
        expect(mocks.copy).not.toHaveBeenCalled()
        expect(mocks.success).not.toHaveBeenCalled()
    })

    it.each(["reject", "false"])(
        "never reports success on clipboard failure: %s",
        async (failure) => {
            if (failure === "reject") mocks.copy.mockRejectedValue(new Error("permission denied"))
            else mocks.copy.mockResolvedValue(false)
            render(<NotificationURLCopyButton notificationId={7} />)
            fireEvent.click(button())
            await waitFor(() =>
                expect(mocks.error).toHaveBeenCalledWith("复制失败，请允许浏览器访问剪贴板后重试"),
            )
            expect(mocks.success).not.toHaveBeenCalled()
            expect(button().disabled).toBe(false)
            mocks.copy.mockResolvedValue(true)
            fireEvent.click(button())
            await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1))
        },
    )

    it("reads the latest URL on every copy rather than caching old credentials", async () => {
        mocks.read
            .mockResolvedValueOnce({ url: completeURL })
            .mockResolvedValueOnce({ url: "https://hooks.example/new?token=updated_fixture" })
        render(<NotificationURLCopyButton notificationId={7} />)
        fireEvent.click(button())
        await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1))
        fireEvent.click(button())
        await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(2))
        expect(mocks.copy.mock.calls.map(([url]) => url)).toEqual([
            completeURL,
            "https://hooks.example/new?token=updated_fixture",
        ])
    })

    it("resets the copied indicator and clears its timer on unmount", async () => {
        vi.useFakeTimers()
        const view = render(<NotificationURLCopyButton notificationId={7} />)
        await act(async () => fireEvent.click(button()))
        expect(button().querySelector(".lucide-check")).not.toBeNull()
        await act(async () => vi.advanceTimersByTime(2000))
        expect(button().querySelector(".lucide-clipboard")).not.toBeNull()
        await act(async () => fireEvent.click(button()))
        view.unmount()
        expect(vi.getTimerCount()).toBe(0)
    })
})
