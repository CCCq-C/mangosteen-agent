import { describe, expect, it, vi } from "vitest"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import { installModelscopeSkill, recommendedModelscopeSkills, searchModelscopeSkills } from "./modelscope"

describe("ModelScope bridge", () => {
  it("searches the native ModelScope command with a bounded query", async () => {
    invokeMock.mockResolvedValueOnce([])

    await searchModelscopeSkills("PDF")

    expect(invokeMock).toHaveBeenCalledWith("modelscope_search", { query: "PDF", limit: 12 })
  })

  it("installs a ModelScope skill into the active knowledge-base project", async () => {
    invokeMock.mockResolvedValueOnce(undefined)

    await installModelscopeSkill("E:/LLMWiki/Test01/山竹", "@anthropics/pdf")

    expect(invokeMock).toHaveBeenCalledWith("modelscope_install", {
      projectPath: "E:/LLMWiki/Test01/山竹",
      skillId: "@anthropics/pdf",
    })
  })

  it("loads the requested ModelScope recommendation page", async () => {
    invokeMock.mockResolvedValueOnce([])

    await recommendedModelscopeSkills(2)

    expect(invokeMock).toHaveBeenCalledWith("modelscope_recommended", { page: 2 })
  })
})
