export interface Scenario {
  id:       string
  label:    string
  offsetMs: number
  savedAt:  number   // wall-clock ms when saved — for display only
}

const KEY = 'sattrack_scenarios'

export function loadScenarios(): Scenario[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Scenario[]) : []
  } catch { return [] }
}

export function saveScenarios(scenarios: Scenario[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(scenarios)) } catch {}
}
