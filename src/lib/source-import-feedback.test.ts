import { describe, expect, it } from "vitest"

import { buildSourceImportFeedback } from "./source-import-feedback"

describe("source import chat feedback", () => {
  it("does not claim background processing when a file was only saved", () => {
    const feedback = buildSourceImportFeedback({
      imported: ["C:/project/raw/sources/培训资料.pdf"],
      skipped: [],
      ingestStatus: "saved-only",
      ingestTaskIds: [],
    })

    expect(feedback.success).toBe(true)
    expect(feedback.message).toContain("文件已保存")
    expect(feedback.message).toContain("尚未整理")
    expect(feedback.message).not.toContain("正在后台整理")
  })

  it("says the file entered the queue only when an ingest task exists", () => {
    const feedback = buildSourceImportFeedback({
      imported: ["C:/project/raw/sources/培训资料.pdf"],
      skipped: [],
      ingestStatus: "queued",
      ingestTaskIds: ["task-1"],
    })

    expect(feedback.success).toBe(true)
    expect(feedback.message).toContain("已进入后台整理队列")
  })

  it("shows the real ingest failure after the file was saved", () => {
    const feedback = buildSourceImportFeedback({
      imported: ["C:/project/raw/sources/培训资料.pdf"],
      skipped: [],
      ingestStatus: "saved-only",
      ingestTaskIds: [],
      ingestError: "无法保存整理队列",
    })

    expect(feedback.success).toBe(true)
    expect(feedback.message).toContain("文件已保存")
    expect(feedback.message).toContain("整理未启动")
    expect(feedback.message).toContain("无法保存整理队列")
  })
})
