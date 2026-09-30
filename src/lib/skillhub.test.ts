import { describe, expect, it, vi } from "vitest"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import { installSkillhubSkill, recommendedSkillhubSkills, searchSkillhubSkills } from "./skillhub"

describe("SkillHub bridge", () => {
  it("searches the native SkillHub command with a bounded query", async () => {
    invokeMock.mockResolvedValueOnce([])

    await searchSkillhubSkills("PDF")

    expect(invokeMock).toHaveBeenCalledWith("skillhub_search", { query: "PDF", limit: 12 })
  })

  it("installs only into the active knowledge-base project", async () => {
    invokeMock.mockResolvedValueOnce(undefined)

    await installSkillhubSkill("E:/LLMWiki/Test01/山竹", "@global/docx-to-pdf")

    expect(invokeMock).toHaveBeenCalledWith("skillhub_install", {
      projectPath: "E:/LLMWiki/Test01/山竹",
      coordinate: "@global/docx-to-pdf",
    })
  })

  it("loads the requested SkillHub recommendation page", async () => {
    invokeMock.mockResolvedValueOnce([])

    await recommendedSkillhubSkills(2)

    expect(invokeMock).toHaveBeenCalledWith("skillhub_recommended", { page: 2 })
  })
})
