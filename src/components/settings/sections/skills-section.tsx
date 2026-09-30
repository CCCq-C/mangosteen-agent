import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { invoke } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { ChevronLeft, ChevronRight, Cloud, Download, Eye, Heart, RefreshCw, Search, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { saveChatPreferences } from "@/lib/persist"
import { getTaskLlmConfig } from "@/lib/llm-task-routing"
import { translateMarketplaceSummaries } from "@/lib/marketplace-summary"
import { installSkillhubSkill, recommendedSkillhubSkills, searchSkillhubSkills, type SkillhubSkill } from "@/lib/skillhub"
import { installModelscopeSkill, recommendedModelscopeSkills, searchModelscopeSkills, type ModelscopeSkill } from "@/lib/modelscope"

interface AvailableAgentSkill {
  id: string
  name: string
  description?: string
  source: string
}

type MarketplaceSource = "skillhub" | "modelscope"

interface MarketplaceSkill {
  id: string
  name: string
  summary: string
  source: MarketplaceSource
  version?: string
  logoUrl?: string
  sourceUrl: string
  downloads?: number
  stars?: number
  views?: number
}

function sourceLabel(source: string, t: ReturnType<typeof useTranslation>["t"]) {
  return t(`chat.skillSources.${source}`, { defaultValue: source })
}

function MarketplaceSkillCard({
  skill,
  installing,
  disabled,
  onInstall,
}: {
  skill: MarketplaceSkill
  installing: boolean
  disabled: boolean
  onInstall: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/20 p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {skill.logoUrl ? (
            <img src={skill.logoUrl} alt="" className="h-6 w-6 rounded object-cover" />
          ) : skill.source === "modelscope" ? (
            <Cloud className="h-4 w-4 text-sky-500" />
          ) : (
            <Sparkles className="h-4 w-4 text-amber-500" />
          )}
          <button
            type="button"
            className="font-medium hover:text-primary hover:underline"
            onClick={() => void openUrl(skill.sourceUrl).catch((err) => console.warn("[skills] openUrl failed:", err))}
            title={`打开 ${skill.name} 的官网页面`}
          >
            {skill.name}
          </button>
          <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{skill.id}</code>
          {skill.version && <span className="text-xs text-muted-foreground">v{skill.version}</span>}
          {typeof skill.stars === "number" && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Heart className="h-3 w-3" />{skill.stars.toLocaleString()}</span>}
          {typeof skill.downloads === "number" && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Download className="h-3 w-3" />{skill.downloads.toLocaleString()}</span>}
          {typeof skill.views === "number" && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Eye className="h-3 w-3" />{skill.views.toLocaleString()}</span>}
        </div>
        {skill.summary && <p className="mt-1 text-xs text-muted-foreground">{skill.summary}</p>}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onInstall} disabled={installing || disabled}>
        <Download className={`mr-1.5 h-3.5 w-3.5 ${installing ? "animate-pulse" : ""}`} />
        {installing ? "安装中" : "安装并启用"}
      </Button>
    </div>
  )
}

export function SkillsSection() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const useWebSearch = useChatStore((s) => s.useWebSearch)
  const agentMode = useChatStore((s) => s.agentMode)
  const retrievalMode = useChatStore((s) => s.retrievalMode)
  const selectedSkills = useChatStore((s) => s.selectedSkills)
  const disabledSkills = useChatStore((s) => s.disabledSkills)
  const setSelectedSkills = useChatStore((s) => s.setSelectedSkills)
  const setDisabledSkills = useChatStore((s) => s.setDisabledSkills)

  const [skills, setSkills] = useState<AvailableAgentSkill[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [marketSource, setMarketSource] = useState<MarketplaceSource>("skillhub")
  const [marketQuery, setMarketQuery] = useState("")
  const [featuredSkills, setFeaturedSkills] = useState<MarketplaceSkill[]>([])
  const [featuredPage, setFeaturedPage] = useState(1)
  const [featuredHasNext, setFeaturedHasNext] = useState(false)
  const [featuredTotal, setFeaturedTotal] = useState(0)
  const [marketSkills, setMarketSkills] = useState<MarketplaceSkill[]>([])
  const [featuredLoading, setFeaturedLoading] = useState(false)
  const [marketLoading, setMarketLoading] = useState(false)
  const [installingCoordinate, setInstallingCoordinate] = useState<string | null>(null)
  const translatedSummaries = useRef(new Map<string, string>())
  const recommendationRequest = useRef(0)

  const disabled = useMemo(() => new Set(disabledSkills), [disabledSkills])
  const enabledCount = skills.filter((skill) => !disabled.has(skill.id)).length
  const filteredSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return skills
    return skills.filter((skill) => {
      const fields = [
        skill.name,
        skill.id,
        skill.description ?? "",
        sourceLabel(skill.source, t),
        skill.source,
      ]
      return fields.some((field) => field.toLowerCase().includes(query))
    })
  }, [searchQuery, skills, t])

  const persist = useCallback(async (nextSelected: string[], nextDisabled: string[]) => {
    if (!project?.path) return
    await saveChatPreferences(project.path, {
      useWebSearch,
      agentMode,
      retrievalMode,
      selectedSkills: nextSelected,
      disabledSkills: nextDisabled,
    })
  }, [agentMode, project?.path, retrievalMode, useWebSearch])

  const scan = useCallback(async () => {
    if (!project?.path) {
      setSkills([])
      return
    }
    setLoading(true)
    setStatus(null)
    try {
      const found = await invoke<AvailableAgentSkill[]>("agent_list_skills", {
        projectPath: project.path,
      })
      setSkills(found)
      const foundIds = new Set(found.map((skill) => skill.id))
      const currentSelected = useChatStore.getState().selectedSkills
      const currentDisabled = useChatStore.getState().disabledSkills
      const currentDisabledSet = new Set(currentDisabled)
      const nextSelected = currentSelected.filter((id) => foundIds.has(id) && !currentDisabledSet.has(id))
      // Keep disabled ids even when a root is temporarily unavailable or a skill
      // folder is not currently mounted. Otherwise a deliberately disabled skill
      // would come back enabled after the next successful scan.
      const nextDisabled = currentDisabled
      if (nextSelected.length !== currentSelected.length) {
        setSelectedSkills(nextSelected)
        await persist(nextSelected, nextDisabled)
      }
      setStatus(t("settings.sections.skills.scanDone", {
        defaultValue: "发现 {{count}} 个技能。",
        count: found.length,
      }))
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [persist, project?.path, setSelectedSkills, t])

  useEffect(() => {
    void scan()
  }, [scan])

  const setSkillEnabled = useCallback(async (id: string, enabled: boolean) => {
    const nextDisabled = enabled
      ? disabledSkills.filter((item) => item !== id)
      : Array.from(new Set([...disabledSkills, id]))
    const nextSelected = enabled
      ? selectedSkills
      : selectedSkills.filter((item) => item !== id)
    setDisabledSkills(nextDisabled)
    if (nextSelected.length !== selectedSkills.length) setSelectedSkills(nextSelected)
    await persist(nextSelected, nextDisabled)
  }, [disabledSkills, persist, selectedSkills, setDisabledSkills, setSelectedSkills])

  const setAllEnabled = useCallback(async (enabled: boolean) => {
    const allIds = skills.map((skill) => skill.id)
    const all = new Set(allIds)
    const nextDisabled = enabled ? [] : allIds
    const nextSelected = enabled ? selectedSkills : selectedSkills.filter((id) => !all.has(id))
    setDisabledSkills(nextDisabled)
    if (nextSelected.length !== selectedSkills.length) setSelectedSkills(nextSelected)
    await persist(nextSelected, nextDisabled)
  }, [persist, selectedSkills, setDisabledSkills, setSelectedSkills, skills])

  const searchMarketplace = useCallback(async () => {
    const query = marketQuery.trim()
    if (!query) return
    setMarketLoading(true)
    setStatus(null)
    try {
      if (marketSource === "skillhub") {
        const found = await searchSkillhubSkills(query)
        setMarketSkills(found.map((skill: SkillhubSkill) => ({
          id: `@${skill.namespace}/${skill.slug}`,
          name: skill.slug,
          summary: skill.summary,
          source: "skillhub",
          version: skill.latestVersion,
          sourceUrl: skill.sourceUrl,
          downloads: skill.downloads,
          stars: skill.stars,
        })))
      } else {
        const found = await searchModelscopeSkills(query)
        setMarketSkills(found.map((skill: ModelscopeSkill) => ({
          id: skill.id,
          name: skill.displayName,
          summary: skill.description,
          source: "modelscope",
          logoUrl: skill.logoUrl,
          sourceUrl: skill.sourceUrl,
          downloads: skill.downloads,
          views: skill.viewCount,
        })))
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setMarketLoading(false)
    }
  }, [marketQuery, marketSource])

  const loadRecommendations = useCallback(async () => {
    const requestId = ++recommendationRequest.current
    setFeaturedLoading(true)
    try {
      if (marketSource === "skillhub") {
        const found = await recommendedSkillhubSkills(featuredPage)
        const nextSkills: MarketplaceSkill[] = found.items.map((skill: SkillhubSkill) => ({
          id: `@${skill.namespace}/${skill.slug}`,
          name: skill.slug,
          summary: skill.summary,
          source: "skillhub",
          version: skill.latestVersion,
          sourceUrl: skill.sourceUrl,
          downloads: skill.downloads,
          stars: skill.stars,
        }))
        setFeaturedHasNext(Boolean(found.nextCursor))
        setFeaturedTotal(0)
        setFeaturedSkills(nextSkills)
        const pending = nextSkills.filter((skill) => !translatedSummaries.current.has(skill.id))
        const translations = await translateMarketplaceSummaries(getTaskLlmConfig("chat"), pending)
        translations.forEach((summary, id) => translatedSummaries.current.set(id, summary))
        if (requestId === recommendationRequest.current && translations.size) {
          setFeaturedSkills((current) => current.map((skill) => ({
            ...skill,
            summary: translatedSummaries.current.get(skill.id) ?? skill.summary,
          })))
        }
      } else {
        const found = await recommendedModelscopeSkills(featuredPage)
        setFeaturedSkills(found.items.map((skill: ModelscopeSkill) => ({
          id: skill.id,
          name: skill.displayName,
          summary: skill.description,
          source: "modelscope",
          logoUrl: skill.logoUrl,
          sourceUrl: skill.sourceUrl,
          downloads: skill.downloads,
          views: skill.viewCount,
        })))
        setFeaturedTotal(found.total)
        setFeaturedHasNext(found.pageNumber * 6 < found.total)
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setFeaturedLoading(false)
    }
  }, [featuredPage, marketSource])

  useEffect(() => {
    void loadRecommendations()
  }, [loadRecommendations])

  const installMarketplaceSkill = useCallback(async (skill: MarketplaceSkill) => {
    if (!project?.path) return
    setInstallingCoordinate(skill.id)
    setStatus(null)
    try {
      if (skill.source === "skillhub") {
        await installSkillhubSkill(project.path, skill.id)
      } else {
        await installModelscopeSkill(project.path, skill.id)
      }
      await scan()
      setStatus(`已安装并启用：${skill.name}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setInstallingCoordinate(null)
    }
  }, [project?.path, scan])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.skills.title", { defaultValue: "技能" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.skills.description", {
            defaultValue:
              "扫描项目和用户级技能文件夹，并选择可以在对话中使用的技能。",
          })}
        </p>
      </div>

      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        {t("settings.sections.skills.paths", {
          defaultValue:
            "扫描目录：.llm-wiki/skills、.agents/skills、~/.claude/skills、~/.codex/skills、~/.agents/skills。",
        })}
      </div>

      <section className="space-y-3 rounded-md border p-3">
        <div>
          <h3 className="font-medium">技能广场</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            国内技能源。安装后只保存到当前知识库，不会改动 Codex 或 Claude 的全局配置。
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={marketSource === "skillhub" ? "default" : "outline"} onClick={() => { setMarketSource("skillhub"); setMarketSkills([]); setFeaturedSkills([]); setFeaturedPage(1) }}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            SkillHub
          </Button>
          <Button type="button" size="sm" variant={marketSource === "modelscope" ? "default" : "outline"} onClick={() => { setMarketSource("modelscope"); setMarketSkills([]); setFeaturedSkills([]); setFeaturedPage(1) }}>
            <Cloud className="mr-1.5 h-3.5 w-3.5" />
            魔搭 ModelScope
          </Button>
        </div>
        <div className="flex gap-2">
          <input
            type="search"
            value={marketQuery}
            onChange={(event) => setMarketQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void searchMarketplace()
            }}
            placeholder={marketSource === "modelscope" ? "搜索魔搭技能，例如 PDF、文档" : "搜索技能，例如 PDF、微信公众号"}
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
          />
          <Button type="button" size="sm" onClick={() => void searchMarketplace()} disabled={marketLoading || !marketQuery.trim()}>
            <Search className={`mr-1.5 h-3.5 w-3.5 ${marketLoading ? "animate-spin" : ""}`} />
            搜索
          </Button>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            推荐技能
            {featuredLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          {featuredSkills.map((skill) => (
            <MarketplaceSkillCard
              key={`featured:${skill.source}:${skill.id}`}
              skill={skill}
              installing={installingCoordinate === skill.id}
              disabled={!project?.path}
              onInstall={() => void installMarketplaceSkill(skill)}
            />
          ))}
          {(featuredPage > 1 || featuredHasNext) && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button type="button" size="sm" variant="outline" onClick={() => setFeaturedPage((page) => Math.max(1, page - 1))} disabled={featuredLoading || featuredPage === 1}>
                <ChevronLeft className="mr-1 h-3.5 w-3.5" />上一页
              </Button>
              <span className="text-xs text-muted-foreground">第 {featuredPage} 页{featuredTotal ? ` / 共 ${Math.ceil(featuredTotal / 6)} 页` : ""}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setFeaturedPage((page) => page + 1)} disabled={featuredLoading || !featuredHasNext}>
                下一页<ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        {marketSkills.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">搜索结果</div>
            {marketSkills.map((skill) => (
              <MarketplaceSkillCard
                key={`${skill.source}:${skill.id}`}
                skill={skill}
                installing={installingCoordinate === skill.id}
                disabled={!project?.path}
                onInstall={() => void installMarketplaceSkill(skill)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("settings.sections.skills.searchPlaceholder", {
              defaultValue: "按名称、ID、描述或来源搜索技能……",
            })}
            className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            {t("settings.sections.skills.summary", {
              defaultValue: "已启用 {{enabled}} 个 / 共发现 {{total}} 个",
              enabled: enabledCount,
              total: skills.length,
            })}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void setAllEnabled(true)} disabled={skills.length === 0}>
              {t("settings.sections.skills.enableAll", { defaultValue: "全部启用" })}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void setAllEnabled(false)} disabled={skills.length === 0}>
              {t("settings.sections.skills.disableAll", { defaultValue: "全部禁用" })}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void scan()} disabled={loading || !project}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              {t("settings.sections.skills.refresh", { defaultValue: "重新扫描" })}
            </Button>
          </div>
        </div>
      </div>

      {status && <p className="text-xs text-muted-foreground">{status}</p>}

      {skills.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          <Sparkles className="mx-auto mb-2 h-5 w-5 opacity-50" />
          {t("settings.sections.skills.empty", {
            defaultValue: "未找到技能。请在扫描目录中添加 SKILL.md 后重新扫描。",
          })}
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          <Search className="mx-auto mb-2 h-5 w-5 opacity-50" />
          {t("settings.sections.skills.noSearchResults", {
            defaultValue: "没有匹配当前搜索的技能。",
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSkills.map((skill) => {
            const active = !disabled.has(skill.id)
            return (
              <div
                key={skill.id}
                className={`rounded-md border p-3 transition-colors ${
                  active ? "bg-background" : "bg-muted/30 opacity-75"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{skill.name}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {sourceLabel(skill.source, t)}
                      </span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {skill.id}
                      </code>
                    </div>
                    {skill.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
                    )}
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(event) => void setSkillEnabled(skill.id, event.target.checked)}
                      className="h-4 w-4"
                    />
                    {active
                      ? t("settings.sections.skills.enabled", { defaultValue: "已启用" })
                      : t("settings.sections.skills.disabled", { defaultValue: "已禁用" })}
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
