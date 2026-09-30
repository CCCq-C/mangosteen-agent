import { invoke } from "@tauri-apps/api/core"

export interface SkillhubSkill {
  namespace: string
  slug: string
  latestVersion: string
  summary: string
  downloads: number
  stars: number
  sourceUrl: string
}

export interface SkillhubRecommendationPage {
  items: SkillhubSkill[]
  nextCursor?: string
}

export function searchSkillhubSkills(query: string): Promise<SkillhubSkill[]> {
  return invoke<SkillhubSkill[]>("skillhub_search", { query, limit: 12 })
}

export function recommendedSkillhubSkills(page?: number): Promise<SkillhubRecommendationPage> {
  return invoke<SkillhubRecommendationPage>("skillhub_recommended", { page })
}

export function installSkillhubSkill(projectPath: string, coordinate: string): Promise<void> {
  return invoke<void>("skillhub_install", { projectPath, coordinate })
}
