import { getFileName } from "@/lib/path-utils"
import type { SourceImportResult } from "@/lib/source-lifecycle"

export function buildSourceImportFeedback(result: SourceImportResult): {
  message: string
  success: boolean
} {
  const imported = result.imported.map(getFileName).join("、")
  const skipped = result.skipped
    .map((item) => `${item.name}（${item.detail ?? item.reason}）`)
    .join("、")

  if (result.imported.length === 0) {
    return {
      message: `这次没有导入文件。${skipped ? `原因：${skipped}` : "请检查文件路径和格式。"}`,
      success: false,
    }
  }

  const suffix = skipped ? `\n\n未导入：${skipped}` : ""
  if (result.ingestStatus === "queued") {
    return {
      message: `已把「${imported}」保存到知识库，并已进入后台整理队列。${suffix}`,
      success: true,
    }
  }

  if (result.ingestError) {
    return {
      message: `文件已保存：已把「${imported}」放入知识库；但整理未启动：${result.ingestError}。你可以稍后在资料页重新整理。${suffix}`,
      success: true,
    }
  }

  return {
    message: `已把「${imported}」保存到知识库。文件已保存，但尚未整理；请先配置“资料整理”模型后再整理。${suffix}`,
    success: true,
  }
}
