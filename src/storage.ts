import { ensureBrowserDraft, ensureBrowserSessions } from "./browserStorage";
import type { Draft, StudioSession } from "./types";

const SESSIONS_KEY = "image2-studio.sessions.v1";
const DRAFT_KEY = "image2-studio.draft.v1";

export const defaultDraft: Draft = {
  prompt: "一只半透明玻璃花瓶，白色百合与深绿色叶片，克制的工作室光线，暖象牙色背景",
  mode: "generate",
  ratio: "1:1",
  size: "1024 x 1024",
  quality: "auto",
  format: "png",
};

export function loadSessions(): StudioSession[] {
  try {
    const saved = localStorage.getItem(SESSIONS_KEY);
    return saved ? ensureBrowserSessions(JSON.parse(saved) as StudioSession[]) : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: StudioSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(ensureBrowserSessions(sessions)));
}

export function sessionsForPersistence(sessions: StudioSession[]): StudioSession[] {
  return ensureBrowserSessions(sessions);
}

export function loadDraft(): Draft {
  try {
    const saved = localStorage.getItem(DRAFT_KEY);
    return saved ? ensureBrowserDraft({ ...defaultDraft, ...(JSON.parse(saved) as Partial<Draft>) }) : defaultDraft;
  } catch {
    return defaultDraft;
  }
}

export function saveDraft(draft: Draft) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(ensureBrowserDraft(draft)));
}
