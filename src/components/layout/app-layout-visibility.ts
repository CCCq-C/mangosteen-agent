import type { WikiState } from "@/stores/wiki-store"
import { isStandaloneView } from "./research-panel-nav"

export function getAppLayoutVisibility(
  activeView: WikiState["activeView"],
  researchPanelOpen: boolean,
): { showLeftPanel: boolean; hasRightPanel: boolean; keepChatMounted: boolean } {
  const isStandalone = isStandaloneView(activeView)
  return {
    showLeftPanel: !isStandalone,
    hasRightPanel: !isStandalone && researchPanelOpen,
    // A running chat owns its stream listeners and abort controller. Keep the
    // panel alive after the user leaves it so navigation cannot orphan a turn.
    keepChatMounted: true,
  }
}
