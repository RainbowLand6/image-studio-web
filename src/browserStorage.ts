import type { Draft, LocalAsset, StudioSession } from "./types";

const SETTINGS_KEY = "image-studio-web.settings.v1";
export const MAX_BROWSER_ASSET_BYTES = 8 * 1024 * 1024;

export interface BrowserSettings {
  apiBaseUrl: string;
  apiKey: string;
}

const defaultSettings: BrowserSettings = {
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
};

export function loadBrowserSettings(): BrowserSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<BrowserSettings>;
    return {
      apiBaseUrl: typeof saved.apiBaseUrl === "string" ? saved.apiBaseUrl : defaultSettings.apiBaseUrl,
      apiKey: typeof saved.apiKey === "string" ? saved.apiKey : defaultSettings.apiKey,
    };
  } catch {
    return defaultSettings;
  }
}

export function saveBrowserSettings(settings: BrowserSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function clearBrowserCredentials() {
  const settings = loadBrowserSettings();
  saveBrowserSettings({ ...settings, apiKey: "" });
}

export async function browserAssetFromFile(file: File): Promise<LocalAsset> {
  if (file.size > MAX_BROWSER_ASSET_BYTES) {
    throw new Error("图片超过 8 MB，无法安全保存在浏览器会话中。");
  }
  return {
    path: `browser-asset:${crypto.randomUUID()}`,
    name: file.name,
    mediaType: file.type || "application/octet-stream",
    byteLength: file.size,
    previewUrl: await fileToDataUrl(file),
  };
}

export async function browserAssetFromBlob(blob: Blob, name: string): Promise<LocalAsset> {
  if (blob.size > MAX_BROWSER_ASSET_BYTES) {
    throw new Error("生成结果超过 8 MB，无法安全保存在浏览器会话中。");
  }
  return {
    path: `browser-asset:${crypto.randomUUID()}`,
    name,
    mediaType: blob.type || "image/png",
    byteLength: blob.size,
    previewUrl: await blobToDataUrl(blob),
  };
}

export async function assetToFile(asset: LocalAsset, fallbackName: string): Promise<File> {
  if (!asset.previewUrl) throw new Error("图片资源不可用，请重新上传。");
  const response = await fetch(asset.previewUrl);
  const blob = await response.blob();
  return new File([blob], asset.name || fallbackName, { type: asset.mediaType || blob.type });
}

export function ensureBrowserDraft(draft: Draft): Draft {
  return {
    ...draft,
    sourceAsset: keepBrowserAsset(draft.sourceAsset),
    maskAsset: keepBrowserAsset(draft.maskAsset),
  };
}

export function ensureBrowserSessions(sessions: StudioSession[]): StudioSession[] {
  return sessions.map((session) => ({
    ...session,
    draft: session.draft ? ensureBrowserDraft(session.draft) : undefined,
    tasks: session.tasks.map((task) => ({
      ...task,
      sourceAsset: keepBrowserAsset(task.sourceAsset),
      maskAsset: keepBrowserAsset(task.maskAsset),
      resultAsset: keepBrowserAsset(task.resultAsset),
    })),
  }));
}

function keepBrowserAsset(asset: LocalAsset | undefined) {
  return asset?.previewUrl?.startsWith("data:") ? asset : undefined;
}

function fileToDataUrl(file: File) {
  return blobToDataUrl(file);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败。"));
    reader.readAsDataURL(blob);
  });
}
