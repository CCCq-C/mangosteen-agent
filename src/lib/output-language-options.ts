/**
 * Shared list of selectable output-language values for any UI that
 * needs to ask the user "what language should the AI generate in?".
 *
 * Currently consumed by:
 *   - Settings → Output: post-create change of the preference
 *   - Create-Project dialog: required choice at project creation
 *     time so a fresh project never starts in the implicit
 *     "auto-detect from whatever text we see first" mode
 *
 * `value` strings are the exact tokens the rest of the codebase
 * compares against (`OutputLanguage` type in stores/wiki-store.ts);
 * keep them in sync. Labels mix the native script + the English
 * name so a user who can't read the native form still recognizes
 * the language.
 */
export const OUTPUT_LANGUAGE_OPTIONS = [
  { value: "auto", label: "自动（跟随输入或资料语言）" },
  { value: "English", label: "英语" },
  { value: "Chinese", label: "简体中文" },
  { value: "Traditional Chinese", label: "繁體中文" },
  { value: "Japanese", label: "日本語（日语）" },
  { value: "Korean", label: "한국어（韩语）" },
  { value: "Vietnamese", label: "Tiếng Việt（越南语）" },
  { value: "French", label: "Français（法语）" },
  { value: "German", label: "Deutsch（德语）" },
  { value: "Spanish", label: "Español（西班牙语）" },
  { value: "Portuguese", label: "Português（葡萄牙语）" },
  { value: "Italian", label: "Italiano（意大利语）" },
  { value: "Russian", label: "Русский（俄语）" },
  { value: "Arabic", label: "العربية（阿拉伯语）" },
  { value: "Persian", label: "فارسی（波斯语）" },
  { value: "Hindi", label: "हिन्दी（印地语）" },
  { value: "Turkish", label: "Türkçe（土耳其语）" },
  { value: "Dutch", label: "Nederlands（荷兰语）" },
  { value: "Polish", label: "Polski（波兰语）" },
  { value: "Czech", label: "Čeština（捷克语）" },
  { value: "Swedish", label: "Svenska（瑞典语）" },
  { value: "Indonesian", label: "Bahasa Indonesia（印度尼西亚语）" },
  { value: "Thai", label: "ไทย（泰语）" },
  { value: "Ukrainian", label: "Українська（乌克兰语）" },
] as const

/** Canonical persisted values accepted by output-language settings. */
export type OutputLanguage = (typeof OUTPUT_LANGUAGE_OPTIONS)[number]["value"]
