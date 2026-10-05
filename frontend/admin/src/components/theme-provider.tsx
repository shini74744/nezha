import { createContext, useContext, useEffect, useState } from "react"

export type Theme = "dark" | "light" | "system"
export const DASHBOARD_THEME_STORAGE_KEY = "nezha-dashboard-theme"

type ThemeProviderProps = {
    children: React.ReactNode
    defaultTheme?: Theme
    storageKey?: string
}

type ThemeProviderState = {
    theme: Theme
    setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
    theme: "system",
    setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)
const isTheme = (value: unknown): value is Theme =>
    value === "light" || value === "dark" || value === "system"

export function ThemeProvider({
    children,
    defaultTheme = "system",
    storageKey = DASHBOARD_THEME_STORAGE_KEY,
    ...props
}: ThemeProviderProps) {
    // Never read or migrate the public site's key: the old shared value cannot
    // tell us which site the user intended to configure.
    const [theme, setTheme] = useState<Theme>(() => {
        try {
            const saved = localStorage.getItem(storageKey)
            return isTheme(saved) ? saved : defaultTheme
        } catch {
            return defaultTheme
        }
    })

    useEffect(() => {
        const root = document.documentElement
        const media = window.matchMedia("(prefers-color-scheme: dark)")
        const apply = () => {
            root.classList.remove("light", "dark")
            root.classList.add(theme === "system" ? media.matches ? "dark" : "light" : theme)
        }
        apply()
        if (theme !== "system") return
        media.addEventListener("change", apply)
        return () => media.removeEventListener("change", apply)
    }, [theme])

    const value = {
        theme,
        setTheme: (next: Theme) => {
            try {
                localStorage.setItem(storageKey, next)
            } catch {
                // The current page still works when browser storage is unavailable.
            }
            setTheme(next)
        },
    }

    return (
        <ThemeProviderContext.Provider {...props} value={value}>
            {children}
        </ThemeProviderContext.Provider>
    )
}

export const useTheme = () => {
    const context = useContext(ThemeProviderContext)
    if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider")
    return context
}
