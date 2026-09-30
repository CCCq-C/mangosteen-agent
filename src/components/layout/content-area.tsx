import { useEffect, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { ChatPanel } from "@/components/chat/chat-panel"
import { SettingsView } from "@/components/settings/settings-view"
import { SkillsSection } from "@/components/settings/sections/skills-section"
import { SourcesView } from "@/components/sources/sources-view"
import { ReviewView } from "@/components/review/review-view"
import { LintView } from "@/components/lint/lint-view"
import { SearchView } from "@/components/search/search-view"
import { GraphView } from "@/components/graph/graph-view"
import { PreviewPanel } from "./preview-panel"
import { getAppLayoutVisibility } from "./app-layout-visibility"

export function ContentArea() {
  const activeView = useWikiStore((s) => s.activeView)

  // Keep SourcesView mounted after its first visit. Opening a source uses the
  // full-width wiki preview, and unmounting the source tree here would discard
  // its scroll position, expanded folders, and incremental row limit. Hiding
  // the mounted view makes closing the preview a true return operation.
  const [hasMountedSources, setHasMountedSources] = useState(activeView === "sources")
  const [hasMountedChat, setHasMountedChat] = useState(activeView === "chat")
  const { keepChatMounted } = getAppLayoutVisibility(activeView, false)

  useEffect(() => {
    if (activeView === "sources") setHasMountedSources(true)
    if (activeView === "chat") setHasMountedChat(true)
  }, [activeView])

  return (
    <>
      {(hasMountedSources || activeView === "sources") && (
        <div className={activeView === "sources" ? "h-full" : "hidden"}>
          <SourcesView />
        </div>
      )}
      {keepChatMounted && hasMountedChat && (
        <div className={activeView === "chat" ? "h-full" : "hidden"}>
          <ChatPanel />
        </div>
      )}
      {activeView !== "sources" && activeView !== "chat" && <ActiveContent activeView={activeView} />}
    </>
  )
}

function ActiveContent({
  activeView,
}: {
  activeView: ReturnType<typeof useWikiStore.getState>["activeView"]
}) {
  switch (activeView) {
    case "chat":
      return <ChatPanel />
    case "wiki":
      return <PreviewPanel />
    case "settings":
      return <SettingsView />
    case "skills":
      return <SkillsView />
    case "sources":
      return null
    case "review":
      return <ReviewView />
    case "lint":
      return <LintView />
    case "search":
      return <SearchView />
    case "graph":
      return <GraphView />
    default:
      return <PreviewPanel />
  }
}

function SkillsView() {
  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-3xl">
        <SkillsSection />
      </div>
    </div>
  )
}
