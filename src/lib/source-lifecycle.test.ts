import { describe, expect, it, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  copyFile: vi.fn(),
  createDirectory: vi.fn(),
  deleteFile: vi.fn(),
  fileExists: vi.fn(),
  getFileMd5: vi.fn(),
  getFileSize: vi.fn(),
  listDirectory: vi.fn(),
  preprocessFile: vi.fn(),
  enqueueBatch: vi.fn(),
}))

vi.mock("@/commands/fs", async () => {
  const actual = await vi.importActual<typeof import("@/commands/fs")>("@/commands/fs")
  return {
    ...actual,
    copyFile: mocks.copyFile,
    createDirectory: mocks.createDirectory,
    deleteFile: mocks.deleteFile,
    fileExists: mocks.fileExists,
    getFileMd5: mocks.getFileMd5,
    getFileSize: mocks.getFileSize,
    listDirectory: mocks.listDirectory,
    preprocessFile: mocks.preprocessFile,
  }
})

vi.mock("@/lib/ingest-queue", () => ({
  enqueueBatch: mocks.enqueueBatch,
}))

import {
  enqueueSourceIngest,
  folderContextForSourcePath,
  importSourceFiles,
  importSourceFolder,
  isIngestableSourcePath,
  sourceImportPathsFromMessage,
} from "./source-lifecycle"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.copyFile.mockResolvedValue(undefined)
  mocks.createDirectory.mockResolvedValue(undefined)
  mocks.deleteFile.mockResolvedValue(undefined)
  mocks.fileExists.mockResolvedValue(false)
  mocks.getFileMd5.mockResolvedValue("md5")
  mocks.getFileSize.mockResolvedValue(1024)
  mocks.listDirectory.mockResolvedValue([])
  mocks.preprocessFile.mockResolvedValue("")
  mocks.enqueueBatch.mockResolvedValue(["task"])
})

describe("source-lifecycle path helpers", () => {
  it("recognizes an explicit Windows PDF save request without treating ordinary file questions as imports", () => {
    const path = "C:\\Users\\c1773\\Downloads\\山竹智能体-内部培训资料.pdf"

    expect(sourceImportPathsFromMessage(`"${path}" 帮我保存到知识库`)).toEqual([path])
    expect(sourceImportPathsFromMessage(`请总结 "${path}" 的内容`)).toEqual([])
    expect(sourceImportPathsFromMessage(`不要把 "${path}" 保存到知识库`)).toEqual([])
  })

  it.each([
    "请把文件导入资料库",
    "把这个文件收录到山竹",
    "请记住这个文件",
    "归档到我的 wiki",
    "帮我存入知识库",
  ])("recognizes common natural-language import request: %s", (request) => {
    const path = "C:\\Users\\c1773\\Downloads\\内部 培训资料.pdf"

    expect(sourceImportPathsFromMessage(`${request} "${path}"`)).toEqual([path])
  })

  it.each([
    "请总结这个文件",
    "不要导入这个文件",
    "把这个文件和最新新闻对比",
    "请告诉我如何把这个文件导入知识库",
    "不需要记住这个文件",
  ])("does not turn a non-import request into a write: %s", (request) => {
    const path = "C:\\Users\\c1773\\Downloads\\内部培训资料.pdf"

    expect(sourceImportPathsFromMessage(`${request} "${path}"`)).toEqual([])
  })

  it("keeps an unsupported local path so the import flow can report the real format error", () => {
    const path = "C:\\Users\\c1773\\Downloads\\安装程序.exe"

    expect(sourceImportPathsFromMessage(`把 "${path}" 保存到知识库`)).toEqual([path])
  })

  it("does not treat preprocessed cache files as ingestable sources", () => {
    expect(isIngestableSourcePath("raw/sources/.cache/report.pdf.txt")).toBe(false)
    expect(isIngestableSourcePath("/project/raw/sources/.cache/report.pdf.txt")).toBe(false)
  })

  it("accepts supported ebook source formats", () => {
    expect(isIngestableSourcePath("raw/sources/book.epub")).toBe(true)
    expect(isIngestableSourcePath("C:\\project\\raw\\sources\\book.MOBI")).toBe(true)
  })

  it("accepts AnyDoc Office and RTF source variants", () => {
    for (const path of [
      "report.docm",
      "deck.ppt",
      "show.ppsm",
      "workbook.xlsb",
      "notes.rtf",
    ]) {
      expect(isIngestableSourcePath(`raw/sources/${path}`)).toBe(true)
    }
  })

  it("derives folder context from absolute raw/sources paths without leaking the project prefix", () => {
    expect(
      folderContextForSourcePath("/tmp/project/raw/sources/reports/2026/report.pdf"),
    ).toBe("reports > 2026")
  })

  it("applies source watch exclusions during folder import before preprocess and ingest", async () => {
    mocks.listDirectory.mockResolvedValue([
      { name: "keep.md", path: "/external/imported/keep.md", is_dir: false },
      { name: "config.json", path: "/external/imported/config.json", is_dir: false },
      {
        name: "drafts",
        path: "/external/imported/drafts",
        is_dir: true,
        children: [
          { name: "skip.md", path: "/external/imported/drafts/skip.md", is_dir: false },
        ],
      },
    ])

    const copied = await importSourceFolder(
      { id: "p1", name: "Project", path: "/project" },
      "/external/imported",
      {
        provider: "openai",
        endpoint: "https://api.example.com/v1",
        apiKey: "key",
        model: "model",
        customModel: "",
        reasoning: { enabled: false, effort: "low" },
      } as never,
      {
        enabled: true,
        autoIngest: true,
        persistExtractedMarkdown: false,
        parsingConcurrency: 2,
        ingestConcurrency: 1,
        includeExtensions: ["md"],
        excludeExtensions: ["json"],
        excludeDirs: ["drafts"],
        excludeGlobs: [],
        maxFileSizeMb: 100,
      },
    )

    expect(copied.imported).toEqual(["/project/raw/sources/imported/keep.md"])
    expect(mocks.copyFile).toHaveBeenCalledTimes(1)
    expect(mocks.copyFile).toHaveBeenCalledWith("/external/imported/keep.md", "/project/raw/sources/imported/keep.md")
    expect(mocks.copyFile).not.toHaveBeenCalledWith("/external/imported/config.json", expect.anything())
    expect(mocks.copyFile).not.toHaveBeenCalledWith("/external/imported/drafts/skip.md", expect.anything())
    expect(mocks.deleteFile).not.toHaveBeenCalled()
    expect(mocks.preprocessFile).toHaveBeenCalledOnce()
    expect(mocks.preprocessFile).toHaveBeenCalledWith("/project/raw/sources/imported/keep.md")
    expect(mocks.enqueueBatch).toHaveBeenCalledWith("p1", [
      {
        sourcePath: "/project/raw/sources/imported/keep.md",
        folderContext: "imported",
      },
    ])
  })

  it("does not import config-like files from hidden tool folders", async () => {
    mocks.listDirectory.mockResolvedValue([
      {
        name: ".claude",
        path: "/external/imported/.claude",
        is_dir: true,
        children: [
          { name: "settings.json", path: "/external/imported/.claude/settings.json", is_dir: false },
          { name: "research.md", path: "/external/imported/.claude/research.md", is_dir: false },
        ],
      },
      {
        name: ".codex",
        path: "/external/imported/.codex",
        is_dir: true,
        children: [
          { name: "config.yaml", path: "/external/imported/.codex/config.yaml", is_dir: false },
        ],
      },
    ])

    const copied = await importSourceFolder(
      { id: "p1", name: "Project", path: "/project" },
      "/external/imported",
      {
        provider: "openai",
        endpoint: "https://api.example.com/v1",
        apiKey: "key",
        model: "model",
        customModel: "",
        reasoning: { enabled: false, effort: "low" },
      } as never,
      {
        enabled: true,
        autoIngest: true,
        persistExtractedMarkdown: false,
        parsingConcurrency: 2,
        ingestConcurrency: 1,
        includeExtensions: ["json", "yaml", "md"],
        excludeExtensions: [],
        excludeDirs: [],
        excludeGlobs: [],
        maxFileSizeMb: 100,
      },
    )

    expect(copied.imported).toEqual(["/project/raw/sources/imported/.claude/research.md"])
    expect(mocks.copyFile).toHaveBeenCalledTimes(1)
    expect(mocks.copyFile).toHaveBeenCalledWith(
      "/external/imported/.claude/research.md",
      "/project/raw/sources/imported/.claude/research.md",
    )
    expect(mocks.copyFile).not.toHaveBeenCalledWith("/external/imported/.claude/settings.json", expect.anything())
    expect(mocks.copyFile).not.toHaveBeenCalledWith("/external/imported/.codex/config.yaml", expect.anything())
  })

  it("rejects importing the project folder or folders inside it", async () => {
    await expect(
      importSourceFolder(
        { id: "p1", name: "Project", path: "/project" },
        "/project",
        {
          provider: "openai",
          endpoint: "https://api.example.com/v1",
          apiKey: "key",
          model: "model",
          customModel: "",
          reasoning: { enabled: false, effort: "low" },
        } as never,
      ),
    ).rejects.toThrow("Cannot import the project folder")

    await expect(
      importSourceFolder(
        { id: "p1", name: "Project", path: "/project" },
        "/project/raw/sources",
        {
          provider: "openai",
          endpoint: "https://api.example.com/v1",
          apiKey: "key",
          model: "model",
          customModel: "",
          reasoning: { enabled: false, effort: "low" },
        } as never,
      ),
    ).rejects.toThrow("Cannot import the project folder")

    expect(mocks.listDirectory).not.toHaveBeenCalled()
    expect(mocks.copyFile).not.toHaveBeenCalled()
  })

  it("filters single-file imports using the original source path before copying", async () => {
    const copied = await importSourceFiles(
      { id: "p1", name: "Project", path: "/project" },
      ["/external/drafts/spec.md", "/external/ready.md"],
      {
        provider: "openai",
        endpoint: "https://api.example.com/v1",
        apiKey: "key",
        model: "model",
        customModel: "",
        reasoning: { enabled: false, effort: "low" },
      } as never,
      {
        enabled: true,
        autoIngest: true,
        persistExtractedMarkdown: false,
        parsingConcurrency: 2,
        ingestConcurrency: 1,
        includeExtensions: ["md"],
        excludeExtensions: [],
        excludeDirs: ["drafts"],
        excludeGlobs: [],
        maxFileSizeMb: 100,
      },
    )

    expect(copied.imported).toEqual(["/project/raw/sources/ready.md"])
    expect(copied.ingestStatus).toBe("queued")
    expect(copied.ingestTaskIds).toEqual(["task"])
    expect(mocks.copyFile).toHaveBeenCalledTimes(1)
    expect(mocks.copyFile).toHaveBeenCalledWith("/external/ready.md", "/project/raw/sources/ready.md")
    expect(mocks.copyFile).not.toHaveBeenCalledWith("/external/drafts/spec.md", expect.anything())
    expect(mocks.enqueueBatch).toHaveBeenCalledWith("p1", [
      {
        sourcePath: "/project/raw/sources/ready.md",
        folderContext: "",
      },
    ])
  })

  it("allows an explicitly selected ebook with an older watch include-list", async () => {
    const copied = await importSourceFiles(
      { id: "p1", name: "Project", path: "/project" },
      ["/external/book.epub"],
      {
        provider: "openai",
        endpoint: "https://api.example.com/v1",
        apiKey: "key",
        model: "model",
        customModel: "",
        reasoning: { enabled: false, effort: "low" },
      } as never,
      {
        enabled: true,
        autoIngest: true,
        persistExtractedMarkdown: false,
        parsingConcurrency: 2,
        ingestConcurrency: 1,
        includeExtensions: ["md", "pdf"],
        excludeExtensions: [],
        excludeDirs: [],
        excludeGlobs: [],
        maxFileSizeMb: 100,
      },
    )

    expect(copied.imported).toEqual(["/project/raw/sources/book.epub"])
    expect(mocks.copyFile).toHaveBeenCalledWith(
      "/external/book.epub",
      "/project/raw/sources/book.epub",
    )
  })

  it("skips sensitive tool config files at the shared ingest enqueue boundary", async () => {
    const queued = await enqueueSourceIngest(
      { id: "p1", name: "Project", path: "/project" },
      [
        "/project/raw/sources/.claude/settings.json",
        "/project/raw/sources/.codex/config.yaml",
        "/project/raw/sources/notes.md",
      ],
      {
        provider: "openai",
        endpoint: "https://api.example.com/v1",
        apiKey: "key",
        model: "model",
        customModel: "",
        reasoning: { enabled: false, effort: "low" },
      } as never,
    )

    expect(queued).toEqual(["task"])
    expect(mocks.enqueueBatch).toHaveBeenCalledWith("p1", [
      {
        sourcePath: "/project/raw/sources/notes.md",
        folderContext: "",
      },
    ])
  })

  it("preprocesses and queues files through the normalized Codex ingest path", async () => {
    const queued = await enqueueSourceIngest(
      { id: "p1", name: "Project", path: "/project" },
      ["/project/raw/sources/report.pdf"],
      {
        provider: "openai",
        apiKey: "",
        model: "gpt-5",
        ollamaUrl: "",
        customEndpoint: "",
        maxContextSize: 128_000,
      },
    )

    expect(queued).toEqual(["task"])
    expect(mocks.preprocessFile).toHaveBeenCalledWith("/project/raw/sources/report.pdf")
    expect(mocks.enqueueBatch).toHaveBeenCalledWith("p1", [
      { sourcePath: "/project/raw/sources/report.pdf", folderContext: "" },
    ])
  })

  it("naturally orders imported folder files before enqueueing ingest tasks", async () => {
    mocks.listDirectory.mockResolvedValue([
      { name: "10.md", path: "/external/imported/10.md", is_dir: false },
      { name: "2.md", path: "/external/imported/2.md", is_dir: false },
      { name: "1.md", path: "/external/imported/1.md", is_dir: false },
    ])

    const copied = await importSourceFolder(
      { id: "p1", name: "Project", path: "/project" },
      "/external/imported",
      {
        provider: "openai",
        endpoint: "https://api.example.com/v1",
        apiKey: "key",
        model: "model",
        customModel: "",
        reasoning: { enabled: false, effort: "low" },
      } as never,
      {
        enabled: true,
        autoIngest: true,
        persistExtractedMarkdown: false,
        parsingConcurrency: 2,
        ingestConcurrency: 1,
        includeExtensions: ["md"],
        excludeExtensions: [],
        excludeDirs: [],
        excludeGlobs: [],
        maxFileSizeMb: 100,
      },
    )

    expect(copied.imported).toEqual([
      "/project/raw/sources/imported/1.md",
      "/project/raw/sources/imported/2.md",
      "/project/raw/sources/imported/10.md",
    ])
    expect(mocks.enqueueBatch).toHaveBeenCalledWith("p1", [
      {
        sourcePath: "/project/raw/sources/imported/1.md",
        folderContext: "imported",
      },
      {
        sourcePath: "/project/raw/sources/imported/2.md",
        folderContext: "imported",
      },
      {
        sourcePath: "/project/raw/sources/imported/10.md",
        folderContext: "imported",
      },
    ])
  })
})

describe("source import skip reporting", () => {
  const project = { id: "p1", name: "Project", path: "/project" }

  const llm = {
    provider: "openai",
    endpoint: "https://api.example.com/v1",
    apiKey: "key",
    model: "model",
    customModel: "",
    reasoning: { enabled: false, effort: "low" },
  } as never

  function watchConfig(overrides: Record<string, unknown> = {}) {
    return {
      enabled: true,
      autoIngest: true,
      persistExtractedMarkdown: false,
      parsingConcurrency: 2,
      ingestConcurrency: 1,
      includeExtensions: [],
      excludeExtensions: [],
      excludeDirs: [],
      excludeGlobs: [],
      maxFileSizeMb: 100,
      ...overrides,
    } as never
  }

  it("reports an oversized file instead of dropping it silently", async () => {
    mocks.getFileSize.mockResolvedValue(149696996)

    const result = await importSourceFiles(
      project,
      ["/external/審查資料範例.pdf"],
      llm,
      watchConfig({ maxFileSizeMb: 100 }),
    )

    expect(result.imported).toEqual([])
    expect(result.skipped).toEqual([
      { name: "審查資料範例.pdf", reason: "too-large", detail: "142.8 MB" },
    ])
    expect(mocks.copyFile).not.toHaveBeenCalled()
  })

  it("queues copied files through the normalized Codex ingest path", async () => {
    const result = await importSourceFiles(
      project,
      ["/external/notes.md"],
      {
        provider: "openai",
        apiKey: "",
        model: "gpt-5",
        ollamaUrl: "",
        customEndpoint: "",
        maxContextSize: 128_000,
      },
      watchConfig(),
    )

    expect(result.imported).toEqual(["/project/raw/sources/notes.md"])
    expect(result.ingestStatus).toBe("queued")
    expect(result.ingestTaskIds).toEqual(["task"])
    expect(mocks.preprocessFile).toHaveBeenCalledWith("/project/raw/sources/notes.md")
    expect(mocks.enqueueBatch).toHaveBeenCalledWith("p1", [
      { sourcePath: "/project/raw/sources/notes.md", folderContext: "" },
    ])
  })

  it("skips a same-name file when the knowledge base already has identical content", async () => {
    mocks.fileExists.mockImplementation(async (path: string) =>
      path === "/project/raw/sources/notes.md",
    )
    mocks.getFileMd5.mockResolvedValue("same-content")

    const result = await importSourceFiles(
      project,
      ["/external/notes.md"],
      llm,
      watchConfig(),
    )

    expect(result.imported).toEqual([])
    expect(result.skipped).toEqual([
      { name: "notes.md", reason: "duplicate", detail: "知识库中已存在相同文件" },
    ])
    expect(result.ingestStatus).toBe("not-started")
    expect(mocks.copyFile).not.toHaveBeenCalled()
    expect(mocks.enqueueBatch).not.toHaveBeenCalled()
  })

  it("keeps a copied file and reports the queue error when ingest cannot start", async () => {
    mocks.enqueueBatch.mockRejectedValueOnce(new Error("无法保存整理队列"))

    const result = await importSourceFiles(
      project,
      ["/external/broken.pdf"],
      llm,
      watchConfig(),
    )

    expect(result.imported).toEqual(["/project/raw/sources/broken.pdf"])
    expect(result.ingestStatus).toBe("saved-only")
    expect(result.ingestError).toBe("无法保存整理队列")
    expect(result.ingestTaskIds).toEqual([])
  })

  it("reports file types the picker offers but ingest cannot read", async () => {
    const result = await importSourceFiles(
      project,
      ["/external/script.py", "/external/photo.png", "/external/notes.md"],
      llm,
      watchConfig(),
    )

    expect(result.imported).toEqual(["/project/raw/sources/notes.md"])
    expect(result.skipped).toEqual([
      { name: "script.py", reason: "unsupported-type" },
      { name: "photo.png", reason: "unsupported-type" },
    ])
  })

  it("reports files blocked by an exclusion rule", async () => {
    const result = await importSourceFiles(
      project,
      ["/external/draft-report.pdf", "/external/final.pdf"],
      llm,
      watchConfig({ excludeGlobs: ["draft-*"] }),
    )

    expect(result.imported).toEqual(["/project/raw/sources/final.pdf"])
    expect(result.skipped).toEqual([
      { name: "draft-report.pdf", reason: "excluded" },
    ])
  })

  it("reports a file whose copy fails instead of only logging it", async () => {
    mocks.copyFile.mockRejectedValueOnce(new Error("EACCES: permission denied"))

    const result = await importSourceFiles(
      project,
      ["/external/locked.pdf"],
      llm,
      watchConfig(),
    )

    expect(result.imported).toEqual([])
    expect(result.skipped).toEqual([
      { name: "locked.pdf", reason: "copy-failed", detail: "EACCES: permission denied" },
    ])
  })

  it("reports a file whose size cannot be read", async () => {
    mocks.getFileSize.mockRejectedValueOnce(new Error("ENOENT"))

    const result = await importSourceFiles(
      project,
      ["/external/vanished.pdf"],
      llm,
      watchConfig(),
    )

    expect(result.imported).toEqual([])
    expect(result.skipped).toEqual([
      { name: "vanished.pdf", reason: "unreadable", detail: "ENOENT" },
    ])
  })

  it("reports a withheld tool-config file so it does not just disappear", async () => {
    const result = await importSourceFiles(
      project,
      ["/external/.claude/settings.json", "/external/notes.md"],
      llm,
      watchConfig(),
    )

    expect(result.imported).toEqual(["/project/raw/sources/notes.md"])
    expect(result.skipped).toEqual([
      { name: "settings.json", reason: "sensitive-config" },
    ])
  })

  it("reports a hidden file as excluded rather than an unsupported type", async () => {
    const result = await importSourceFiles(
      project,
      ["/external/.secret-notes.md"],
      llm,
      watchConfig(),
    )

    expect(result.skipped).toEqual([
      { name: ".secret-notes.md", reason: "excluded" },
    ])
  })

  it("reports files a folder import left behind", async () => {
    mocks.listDirectory.mockResolvedValue([
      { name: "keep.md", path: "/external/imported/keep.md", is_dir: false },
      { name: "huge.pdf", path: "/external/imported/huge.pdf", is_dir: false },
      { name: "notes.py", path: "/external/imported/notes.py", is_dir: false },
    ])
    mocks.getFileSize.mockImplementation(async (path: string) =>
      path.endsWith("huge.pdf") ? 149696996 : 1024,
    )

    const result = await importSourceFolder(
      project,
      "/external/imported",
      llm,
      watchConfig({ includeExtensions: ["md", "pdf"] }),
    )

    expect(result.imported).toEqual(["/project/raw/sources/imported/keep.md"])
    expect(result.skipped).toEqual([
      { name: "huge.pdf", reason: "too-large", detail: "142.8 MB" },
      { name: "notes.py", reason: "excluded" },
    ])
  })

  it("continues a folder import after one nested file cannot be copied", async () => {
    mocks.listDirectory.mockResolvedValue([
      {
        name: "nested",
        path: "/external/imported/nested",
        is_dir: true,
        children: [
          { name: "locked.md", path: "/external/imported/nested/locked.md", is_dir: false },
        ],
      },
      { name: "keep.md", path: "/external/imported/keep.md", is_dir: false },
    ])
    mocks.copyFile.mockImplementation(async (source: string) => {
      if (source.endsWith("locked.md")) throw new Error("EACCES")
    })

    const result = await importSourceFolder(
      project,
      "/external/imported",
      llm,
      watchConfig({ includeExtensions: ["md"] }),
    )

    expect(result.imported).toEqual(["/project/raw/sources/imported/keep.md"])
    expect(result.skipped).toEqual([
      { name: "nested/locked.md", reason: "copy-failed", detail: "EACCES" },
    ])
  })
})
