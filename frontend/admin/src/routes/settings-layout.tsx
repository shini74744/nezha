import { SettingsTab } from "@/components/settings-tab"
import { Outlet } from "react-router-dom"

import "./settings-layout.css"

// Keep navigation mounted while only the selected settings page changes.
export default function SettingsLayout() {
    return (
        <div className="settings-layout">
            <SettingsTab className="settings-navigation w-full" />
            <div className="settings-content min-w-0">
                <Outlet />
            </div>
        </div>
    )
}
