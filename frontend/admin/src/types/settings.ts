import i18n from "@/lib/i18n"

export const settingCoverageTypes: Record<number, string> = {
    1: i18n.t("Coverages.Excludes"),
    2: i18n.t("Coverages.Only"),
}

export const nezhaLang: Record<string, string> = {
    "zh-CN": "简体中文（中国大陆）",
    "zh-TW": "正體中文（台灣）",
    "en-US": "English",
    "ru-RU": "Русский",
    "es-ES": "Español",
    "de-DE": "Deutsch",
    "ta-IN": "தமிழ்",
    "it-IT": "Italiano",
    "fr-FR": "Français",
    "id-ID": "Bahasa Indonesia",
    "ja-JP": "日本語",
    "ro-RO": "Română",
    "uk-UA": "Українська",
    "gl-ES": "Galego",
}

// Translate at render time so asynchronously loaded site language is respected.
// IDs are persisted by the backend; keep legacy values and only append new ones.
export const wafBlockReasonKeys: Record<number, string> = {
    1: "LoginFailed",
    2: "BruteForceAttackingToken",
    3: "WAFReasonAgentAuthUnspecified",
    4: "BlockByUser",
    5: "WAFBlockReasonTypeBruteForceOauth2",
    6: "WAFReasonAgentSecretInvalid",
    7: "WAFReasonAgentUUIDInvalid",
    8: "WAFReasonAgentUnknownCredential",
}

export const wafBlockIdentifierKeys: Record<number, string> = {
    "-127": "GrpcAuthFailed",
    "-126": "APITokenInvalid",
    "-125": "UserInvalid",
    "-124": "BlockByUser",
}
