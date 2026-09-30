import { invoke } from "@tauri-apps/api/core"

export interface ModelscopeSkill {
  id: string
  displayName: string
  description: string
  logoUrl: string
  downloads: number
  viewCount: number
  sourceUrl: string
  version: string
}

export interface ModelscopeRecommendationPage {
  items: ModelscopeSkill[]
  pageNumber: number
  total: number
}

export function searchModelscopeSkills(query: string): Promise<ModelscopeSkill[]> {
  return invoke<ModelscopeSkill[]>("modelscope_search", { query, limit: 12 })
}

export function recommendedModelscopeSkills(page?: number): Promise<ModelscopeRecommendationPage> {
  return invoke<ModelscopeRecommendationPage>("modelscope_recommended", { page })
}

export function installModelscopeSkill(projectPath: string, skillId: string): Promise<void> {
  return invoke<void>("modelscope_install", { projectPath, skillId })
}
