import { describe, expect, it } from "vitest"
import { needsChineseTranslation, parseChineseSummaryTranslations } from "./marketplace-summary"

describe("marketplace summary translation", () => {
  it("only translates summaries without Chinese text", () => {
    expect(needsChineseTranslation("Create and edit DOCX files.")).toBe(true)
    expect(needsChineseTranslation("创建和编辑 DOCX 文件。")).toBe(false)
  })

  it("keeps only translated summaries for the requested skills", () => {
    const summaries = parseChineseSummaryTranslations(
      "```json\n[{\"id\":\"word\",\"summary\":\"创建和编辑 Word 文档。\"},{\"id\":\"other\",\"summary\":\"忽略\"}]\n```",
      new Set(["word"]),
    )

    expect(summaries.get("word")).toBe("创建和编辑 Word 文档。")
    expect(summaries.has("other")).toBe(false)
  })
})
