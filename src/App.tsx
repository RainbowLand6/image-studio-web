import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import {
  ArrowUpRight,
  Paintbrush,
  Brush,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileImage,
  FolderOpen,
  Github,
  History,
  ImagePlus,
  Images,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  RefreshCw,
  ScrollText,
  Redo2,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Undo2,
  WandSparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { CreationMode, Draft, LocalAsset, StudioSession, StudioTask, TaskStatus } from "./types";
import { browserAssetFromFile, clearBrowserCredentials, loadBrowserSettings, saveBrowserSettings } from "./browserStorage";
import { defaultDraft, loadDraft, loadSessions, saveDraft, saveSessions } from "./storage";
import { submitBrowserImageTask } from "./webProvider";

interface ProviderCapabilities {
  provider: string;
  model: string;
  supportedModes: string[];
  supportsRemoteRequests: boolean;
  remoteRequestsMessage: string;
  credentialsConfigured: boolean;
}

function useModalDialog(onClose: () => void) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute("hidden"));
    const initialFocus = dialog.querySelector<HTMLElement>("[data-dialog-autofocus]") ?? focusable()[0];
    initialFocus?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return dialogRef;
}

function SettingsOverlay({ settings, onSettingsChange, onClose, onToast }: { settings: AppSettings; onSettingsChange: (settings: AppSettings) => void; onClose: () => void; onToast: (message: string) => void }) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl);
  const hasApiKey = Boolean(settings.apiKey);
  const dialogRef = useModalDialog(onClose);

  function saveSettings() {
    const normalizedBaseUrl = apiBaseUrl.trim().replace(/\/+$/, "");
    if (!normalizedBaseUrl) {
      onToast("请输入 API 接口地址");
      return;
    }
    try {
      const parsedUrl = new URL(normalizedBaseUrl);
      if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
        onToast("API 接口地址必须是无查询参数的 HTTPS 地址");
        return;
      }
    } catch {
      onToast("API 接口地址格式无效");
      return;
    }
    onSettingsChange({ apiBaseUrl: normalizedBaseUrl, apiKey: apiKey.trim() });
    onToast("设置已保存到当前浏览器");
  }

  function clearApiKey() {
    clearBrowserCredentials();
    setApiKey("");
    onSettingsChange({ apiBaseUrl: apiBaseUrl.trim() || settings.apiBaseUrl, apiKey: "" });
    onToast("已清除浏览器中保存的 API Key");
  }

  return <div className="overlay" role="dialog" aria-modal="true" aria-label="设置"><section ref={dialogRef} className="overlay-card settings-card"><header><div><p className="eyebrow">PREFERENCES</p><h2>设置</h2></div><button className="icon-button" onClick={onClose} title="关闭" data-dialog-autofocus><X size={19} /></button></header><div className="setting-section"><div><h3>OpenAI Images API</h3><p>API Key 保存在当前浏览器的本地存储中。共享设备、浏览器扩展和站点脚本可能读取它；请勿在不可信设备上保存。</p></div><label>API Key<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasApiKey ? "已配置，输入新 Key 可替换" : "sk-..."} /></label><small className="setting-hint">配置状态：{hasApiKey ? "已配置（已脱敏）" : "未配置"}</small><div className="settings-actions"><button className="submit-button compact" onClick={saveSettings}>{hasApiKey ? "更新 Key" : "保存 Key"}</button>{hasApiKey && <button className="secondary-button" onClick={clearApiKey}>清除 Key</button>}</div></div><div className="setting-section"><div><h3>接口地址</h3><p>浏览器会直接向此地址发起生成、编辑和局部编辑请求。请使用允许跨域访问的 API 服务。</p></div><label>API 接口地址<input type="url" inputMode="url" autoComplete="url" value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /></label><div className="settings-actions"><button className="submit-button compact" onClick={saveSettings}>保存设置</button></div></div></section></div>;
}

interface ProviderTaskError {
  code: string;
  message: string;
  retryable: boolean;
}

type AppView = "studio" | "sessions" | "requests";

interface RequestLogRecord {
  attemptId: string;
  taskId: string;
  sessionId: string;
  sessionTitle: string;
  prompt: string;
  mode: CreationMode;
  status: TaskStatus;
  createdAt: string;
  apiBaseUrl?: string;
  model?: string;
  resultAsset?: LocalAsset;
  error?: string;
  errorCode?: string;
  retryable?: boolean;
}

interface AppSettings {
  apiBaseUrl: string;
  apiKey: string;
}

const previewProviderCapabilities: ProviderCapabilities = {
  provider: "openai",
  model: "gpt-image-2",
  supportedModes: ["generate", "edit", "inpaint"],
  supportsRemoteRequests: true,
  remoteRequestsMessage: "浏览器会直接向你设置的接口地址发送图片请求。",
  credentialsConfigured: false,
};

const defaultAppSettings: AppSettings = {
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
};

const githubRepositoryUrl = "https://github.com/RainbowLand6/image-studio-web";

const imageSizes = [
  "512 x 1280",
  "768 x 1024",
  "1024 x 768",
  "1024 x 1024",
  "1024 x 1536",
  "1536 x 1024",
  "1024 x 2048",
  "2048 x 1024",
  "1536 x 1536",
  "1440 x 2560",
  "2560 x 1440",
] as const;

const customSizeOption = "__custom__";
const minimumImagePixels = 655_360;
const maximumImagePixels = 2_560 * 1_440;
const minimumImageEdge = 512;
const maximumImageEdge = 2_560;

const sizesByRatio: Record<Draft["ratio"], readonly string[]> = {
  "1:1": ["1024 x 1024", "1536 x 1536"],
  "2:3": ["1024 x 1536", "1024 x 2048", "1440 x 2560"],
  "3:2": ["1024 x 768", "1536 x 1024", "2048 x 1024", "2560 x 1440"],
  auto: imageSizes,
};

const modeMeta: Record<CreationMode, { label: string; action: string; icon: typeof WandSparkles }> = {
  generate: { label: "生成", action: "开始生成", icon: WandSparkles },
  edit: { label: "编辑", action: "开始编辑", icon: ImagePlus },
  inpaint: { label: "局部编辑", action: "开始局部编辑", icon: Paintbrush },
};

const sampleTitle = "玻璃花瓶与百合";

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function displayTime(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  return `${hours} 小时前`;
}

function createSession(draft: Draft = defaultDraft): StudioSession {
  return { id: id("session"), title: "未命名会话", updatedAt: new Date().toISOString(), tasks: [], draft };
}

function getTaskStatusLabel(status: TaskStatus) {
  return { idle: "草稿", queued: "排队中", running: "生成中", succeeded: "已完成", failed: "生成失败" }[status];
}

function requestLogsFromSessions(sessions: StudioSession[], fallbackApiBaseUrl: string, fallbackModel: string): RequestLogRecord[] {
  return sessions.flatMap((session) => session.tasks.flatMap((task) => task.attempts.map((attempt) => ({
    attemptId: attempt.id,
    taskId: task.id,
    sessionId: session.id,
    sessionTitle: session.title,
    prompt: task.prompt,
    mode: task.mode,
    status: attempt.status,
    createdAt: attempt.createdAt,
    apiBaseUrl: attempt.apiBaseUrl ?? fallbackApiBaseUrl,
    model: attempt.model ?? fallbackModel,
    resultAsset: attempt.status === "succeeded" ? task.resultAsset : undefined,
    error: attempt.error,
    errorCode: attempt.errorCode,
    retryable: attempt.retryable,
  })))).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function parseImageSize(size: string) {
  const match = size.match(/^\s*(\d+)\s*x\s*(\d+)\s*$/i);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function imageSizeError(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return "请输入整数宽高";
  if (width % 16 || height % 16) return "宽高必须是 16 的倍数";
  if (width < minimumImageEdge || height < minimumImageEdge || width > maximumImageEdge || height > maximumImageEdge) return "边长范围为 512 至 2560 px";
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (ratio > 3) return "长宽比例需在 1:3 至 3:1 之间";
  const pixels = width * height;
  if (pixels < minimumImagePixels) return "总像素不能低于 655,360";
  if (pixels > maximumImagePixels) return "总像素不能超过 2560 x 1440";
  return null;
}

export function App() {
  const [sessions, setSessions] = useState<StudioSession[]>(loadSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft>(() => sessions[0]?.draft ?? loadDraft());
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [view, setView] = useState<AppView>("studio");
  const [selectedHistorySessionId, setSelectedHistorySessionId] = useState<string | null>(null);
  const [requestLogs, setRequestLogs] = useState<RequestLogRecord[]>([]);
  const [isRequestLogsLoading, setIsRequestLogsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMaskEditorOpen, setIsMaskEditorOpen] = useState(false);
  const [isSessionRailCollapsed, setIsSessionRailCollapsed] = useState(false);
  const [resultPreviewMode, setResultPreviewMode] = useState<"result" | "source" | "compare">("result");
  const [imageViewer, setImageViewer] = useState<{ asset: LocalAsset; label: string } | null>(null);
  const [toast, setToast] = useState("");
  const [providerCapabilities, setProviderCapabilities] = useState<ProviderCapabilities>(() => ({ ...previewProviderCapabilities, credentialsConfigured: Boolean(loadBrowserSettings().apiKey) }));
  const [appSettings, setAppSettings] = useState<AppSettings>(() => ({ ...defaultAppSettings, ...loadBrowserSettings() }));
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const maskInputRef = useRef<HTMLInputElement>(null);
  const [isImportingAsset, setIsImportingAsset] = useState(false);
  const [isExportingResult, setIsExportingResult] = useState(false);
  const initialSize = parseImageSize(draft.size) ?? { width: 1024, height: 1024 };
  const [isCustomSizeSelected, setIsCustomSizeSelected] = useState(false);
  const [customWidth, setCustomWidth] = useState(String(initialSize.width));
  const [customHeight, setCustomHeight] = useState(String(initialSize.height));

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeTask = activeSession?.tasks.find((task) => task.id === activeTaskId);
  const resultAsset = activeTask?.resultAsset;
  const hasRunningTask = sessions.some((session) => session.tasks.some((task) => task.status === "running" || task.status === "queued"));
  const currentMode = modeMeta[draft.mode];
  const ModeIcon = currentMode.icon;
  const availableSizes = draft.mode === "generate" ? sizesByRatio[draft.ratio] : imageSizes;
  const customSizeError = isCustomSizeSelected ? imageSizeError(Number(customWidth), Number(customHeight)) : null;
  const outputLocationLabel = "浏览器原生下载";
  const outputFooterLabel = "下载位置由浏览器下载设置决定";
  const sourceAsset = activeTask?.sourceAsset;
  const canCompareImages = Boolean(
    activeTask?.mode !== "generate"
    && sourceAsset?.previewUrl
    && resultAsset?.previewUrl,
  );

  useEffect(() => {
    setResultPreviewMode("result");
  }, [activeTaskId]);

  useEffect(() => {
    try {
      saveSessions(sessions);
    } catch {
      setToast("浏览器存储空间不足，无法保存完整会话和图片。");
    }
  }, [sessions]);
  useEffect(() => {
    try {
      saveDraft(draft);
    } catch {
      setToast("浏览器存储空间不足，无法保存当前草稿。");
    }
  }, [draft]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (view !== "requests") return;
    void refreshRequestLogs();
  // Refreshing is intentionally tied to entering the page; the explicit button handles later reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function updateDraft(patch: Partial<Draft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (activeSessionId) {
      setSessions((current) => current.map((session) => session.id === activeSessionId ? { ...session, draft: next } : session));
    }
  }

  function ensureSession() {
    if (activeSession) return activeSession;
    const session = createSession(draft);
    setSessions((previous) => [session, ...previous]);
    setActiveSessionId(session.id);
    return session;
  }

  function newSession() {
    const session = createSession();
    setSessions((previous) => [session, ...previous]);
    setActiveSessionId(session.id);
    setDraft(session.draft ?? defaultDraft);
    setActiveTaskId(null);
    setView("studio");
    setToast("已创建新会话");
  }

  function updateSession(sessionId: string, updater: (session: StudioSession) => StudioSession) {
    setSessions((previous) => previous.map((session) => (session.id === sessionId ? updater(session) : session)));
  }

  function openSession(session: StudioSession) {
    setActiveSessionId(session.id);
    setActiveTaskId(session.tasks.at(-1)?.id ?? null);
    setDraft(session.draft ?? defaultDraft);
    setView("studio");
  }

  function ratioForTask(task: StudioTask): Draft["ratio"] {
    if (task.ratio) return task.ratio;
    const size = parseImageSize(task.size);
    if (!size || size.width === size.height) return "1:1";
    return size.width < size.height ? "2:3" : "3:2";
  }

  function draftForTask(task: StudioTask): Draft {
    return {
      prompt: task.prompt,
      mode: task.mode,
      ratio: ratioForTask(task),
      size: task.size,
      quality: task.quality as Draft["quality"],
      format: task.format as Draft["format"],
      sourceAsset: task.sourceAsset,
      maskAsset: task.maskAsset,
    };
  }

  function selectTask(task: StudioTask, sessionId = activeSessionId) {
    const parsedSize = parseImageSize(task.size);
    const restoredDraft = draftForTask(task);
    setActiveTaskId(task.id);
    setIsCustomSizeSelected(!imageSizes.includes(task.size as typeof imageSizes[number]));
    if (parsedSize) {
      setCustomWidth(String(parsedSize.width));
      setCustomHeight(String(parsedSize.height));
    }
    setDraft(restoredDraft);
    if (sessionId) {
      setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, draft: restoredDraft } : session));
    }
  }

  function deleteSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session || !window.confirm(`删除“${session.title}”及其请求记录？此操作不可恢复。`)) return;
    const remaining = sessions.filter((item) => item.id !== sessionId);
    setSessions(remaining);
    setRequestLogs((current) => current.filter((log) => log.sessionId !== sessionId));
    setSelectedHistorySessionId((current) => current === sessionId ? remaining[0]?.id ?? null : current);
    if (activeSessionId === sessionId) {
      const next = remaining[0];
      setActiveSessionId(next?.id ?? "");
      setActiveTaskId(next?.tasks.at(-1)?.id ?? null);
      setDraft(next?.draft ?? defaultDraft);
    }
    setToast("会话已删除");
  }

  function changeMode(mode: CreationMode) {
    const availableSizes = mode === "generate" ? sizesByRatio[draft.ratio] : imageSizes;
    setIsCustomSizeSelected(false);
    updateDraft({
      mode,
      size: availableSizes.includes(draft.size) ? draft.size : availableSizes[0],
    });
  }

  function selectSize(value: string) {
    if (value === customSizeOption) {
      const currentSize = parseImageSize(draft.size) ?? { width: 1024, height: 1024 };
      setCustomWidth(String(currentSize.width));
      setCustomHeight(String(currentSize.height));
      setIsCustomSizeSelected(true);
      return;
    }
    setIsCustomSizeSelected(false);
    updateDraft({ size: value });
  }

  function updateCustomSize(width = customWidth, height = customHeight) {
    setCustomWidth(width);
    setCustomHeight(height);
    const numericWidth = Number(width);
    const numericHeight = Number(height);
    if (!imageSizeError(numericWidth, numericHeight)) {
      updateDraft({ size: `${numericWidth} x ${numericHeight}` });
    }
  }

  async function deleteRequestLog(attemptId: string) {
    const log = requestLogs.find((item) => item.attemptId === attemptId);
    const locatedTask = sessions
      .flatMap((session) => session.tasks.map((task) => ({ session, task })))
      .find(({ task }) => task.attempts.some((attempt) => attempt.id === attemptId));
    const sessionId = log?.sessionId ?? locatedTask?.session.id;
    const taskId = log?.taskId ?? locatedTask?.task.id;
    if (!sessionId || !taskId || !window.confirm("删除这次请求？该请求及其所有重试记录都会从会话记录中删除，此操作不可恢复。")) return;
    const updatedSessions = sessions.map((session) => session.id === sessionId
      ? { ...session, tasks: session.tasks.filter((item) => item.id !== taskId) }
      : session);
    setSessions(updatedSessions);
    setRequestLogs((current) => current.filter((item) => item.taskId !== taskId));
    if (activeTaskId === taskId) {
      const replacementTask = updatedSessions.find((session) => session.id === sessionId)?.tasks.at(-1);
      setActiveTaskId(replacementTask?.id ?? null);
      const replacementDraft = replacementTask ? draftForTask(replacementTask) : defaultDraft;
      setDraft(replacementDraft);
      updateSession(sessionId, (session) => ({ ...session, draft: replacementDraft }));
    }
    setToast("请求及会话记录已删除");
  }

  async function refreshRequestLogs() {
    setIsRequestLogsLoading(true);
    try {
      setRequestLogs(requestLogsFromSessions(sessions, appSettings.apiBaseUrl, providerCapabilities.model));
    } catch {
      setToast("无法读取请求记录");
    } finally {
      setIsRequestLogsLoading(false);
    }
  }

  async function importAsset(file: File): Promise<LocalAsset> {
    return browserAssetFromFile(file);
  }

  function replaceAsset(field: "sourceAsset" | "maskAsset", asset?: LocalAsset) {
    updateDraft({ [field]: asset });
  }

  async function handleAssetChange(field: "sourceAsset" | "maskAsset", file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setToast("请选择图片文件");
      return;
    }
    if (field === "maskAsset" && file.type !== "image/png") {
      setToast("蒙版仅支持带透明通道的 PNG 图片");
      return;
    }

    setIsImportingAsset(true);
    try {
      replaceAsset(field, await importAsset(file));
      setToast("图片已保存到当前浏览器会话");
    } catch {
      setToast("导入图片失败，请检查文件格式与大小");
    } finally {
      setIsImportingAsset(false);
    }
  }

  async function saveMaskAsset(blob: Blob) {
    if (!draft.sourceAsset) return;
    const sourceName = draft.sourceAsset.name.replace(/\.[^.]+$/, "") || "source";
    const maskFile = new File([blob], `${sourceName}-mask.png`, { type: "image/png" });

    setIsImportingAsset(true);
    try {
      replaceAsset("maskAsset", await importAsset(maskFile));
      setIsMaskEditorOpen(false);
      setToast("蒙版已应用到当前浏览器草稿");
    } catch {
      setToast("保存蒙版失败，请重试");
    } finally {
      setIsImportingAsset(false);
    }
  }

  function errorFromUnknown(error: unknown): ProviderTaskError {
    if (typeof error === "string") {
      try {
        return errorFromUnknown(JSON.parse(error));
      } catch {
        return { code: "provider_error", message: error, retryable: true };
      }
    }

    if (typeof error === "object" && error !== null && "message" in error) {
      const providerError = error as Partial<ProviderTaskError>;
      return {
        code: providerError.code ?? "provider_error",
        message: providerError.message ?? "图像任务未完成。",
        retryable: providerError.retryable ?? true,
      };
    }

    return { code: "provider_error", message: "图像任务未完成。", retryable: true };
  }

  async function runTask(sessionId: string, task: StudioTask) {
    const attemptId = task.attempts.at(-1)?.id;

    try {
      const resultAsset = await submitBrowserImageTask({
        mode: task.mode,
        prompt: task.prompt,
        size: task.size,
        quality: task.quality,
        outputFormat: task.format,
        sourceAsset: task.sourceAsset,
        maskAsset: task.maskAsset,
      }, appSettings);
      updateSession(sessionId, (current) => ({
        ...current,
        updatedAt: new Date().toISOString(),
        tasks: current.tasks.map((item) => item.id === task.id ? {
          ...item,
          status: "succeeded",
          completedAt: new Date().toISOString(),
          resultAsset,
          attempts: item.attempts.map((attempt) => attempt.id === attemptId ? { ...attempt, status: "succeeded" } : attempt),
        } : item),
      }));
    } catch (error) {
      const providerError = errorFromUnknown(error);
      updateSession(sessionId, (current) => ({
        ...current,
        updatedAt: new Date().toISOString(),
        tasks: current.tasks.map((item) => item.id === task.id ? {
          ...item,
          status: "failed",
          completedAt: new Date().toISOString(),
          attempts: item.attempts.map((attempt) => attempt.id === attemptId ? {
            ...attempt,
            status: "failed",
            error: providerError.message,
            errorCode: providerError.code,
            retryable: providerError.retryable,
          } : attempt),
        } : item),
      }));
    }
  }

  function submitTask() {
    if (hasRunningTask) {
      setToast("请等待当前任务完成后再提交");
      return;
    }
    if (!draft.prompt.trim()) {
      setToast("请输入创作指令");
      return;
    }
    if (isCustomSizeSelected && customSizeError) {
      setToast(customSizeError);
      return;
    }
    const selectedSize = parseImageSize(draft.size);
    if (!selectedSize || imageSizeError(selectedSize.width, selectedSize.height)) {
      setToast("请选择符合规则的图片尺寸");
      return;
    }
    if (draft.mode === "edit" && !draft.sourceAsset) {
      setToast("图生图需要先选择源图");
      return;
    }
    if (draft.mode === "inpaint" && (!draft.sourceAsset || !draft.maskAsset)) {
      setToast("局部编辑需要源图和蒙版");
      return;
    }
    const session = ensureSession();
    const now = new Date().toISOString();
    const task: StudioTask = {
      id: id("task"),
      prompt: draft.prompt.trim(),
      mode: draft.mode,
      status: "running",
      createdAt: now,
      ratio: draft.ratio,
      size: draft.size,
      quality: draft.quality,
      format: draft.format,
      sourceAsset: draft.sourceAsset,
      maskAsset: draft.maskAsset,
      attempts: [{
        id: id("attempt"),
        status: "running",
        createdAt: now,
        apiBaseUrl: appSettings.apiBaseUrl,
        model: providerCapabilities.model,
      }],
    };
    updateSession(session.id, (current) => ({
      ...current,
      title: current.tasks.length === 0 ? task.prompt.slice(0, 18) || sampleTitle : current.title,
      updatedAt: now,
      tasks: [...current.tasks, task],
    }));
    setActiveTaskId(task.id);
    void runTask(session.id, task);
  }

  function retryTask(task: StudioTask) {
    if (!activeSession) return;
    if (hasRunningTask) {
      setToast("请等待当前任务完成后再重试");
      return;
    }
    const now = new Date().toISOString();
    const attempt = {
      id: id("attempt"),
      status: "running" as const,
      createdAt: now,
      apiBaseUrl: appSettings.apiBaseUrl,
      model: providerCapabilities.model,
    };
    updateSession(activeSession.id, (current) => ({
      ...current,
      updatedAt: now,
      tasks: current.tasks.map((item) => item.id === task.id ? {
        ...item,
        status: "running",
        completedAt: undefined,
        attempts: [...item.attempts, attempt],
      } : item),
    }));
    void runTask(activeSession.id, {
      ...task,
      status: "running",
      completedAt: undefined,
      attempts: [...task.attempts, attempt],
    });
  }

  function copyPrompt(prompt: string) {
    void navigator.clipboard.writeText(prompt)
      .then(() => setToast("提示词已复制"))
      .catch(() => setToast("无法访问系统剪贴板，请手动复制提示词"));
  }

  function continueEditing(mode: CreationMode) {
    if (!resultAsset) {
      setToast("任务结果尚未导入本地资源库");
      return;
    }
    updateDraft({
      mode,
      prompt: activeTask?.prompt ?? draft.prompt,
      sourceAsset: resultAsset,
      maskAsset: undefined,
    });
    if (mode === "inpaint") setIsMaskEditorOpen(true);
    setToast(mode === "inpaint" ? "已将结果带入局部编辑草稿，请添加蒙版" : "已将生成结果作为编辑源图带入");
  }

  async function downloadResult() {
    if (!resultAsset?.previewUrl) {
      setToast("下载需要结果资产与本地导出能力");
      return;
    }

    setIsExportingResult(true);
    try {
      const link = document.createElement("a");
      link.href = resultAsset.previewUrl;
      link.download = resultAsset.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setIsExportingResult(false);
    }
  }

  function openExternalLink(url: string) {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) setToast("无法打开链接，请检查浏览器弹窗设置");
  }

  function saveWebSettings(nextSettings: AppSettings) {
    saveBrowserSettings(nextSettings);
    setAppSettings(nextSettings);
    setProviderCapabilities((current) => ({
      ...current,
      credentialsConfigured: Boolean(nextSettings.apiKey),
    }));
  }

  return (
    <main className={`studio-shell ${isSessionRailCollapsed ? "is-session-rail-collapsed" : ""}`}>
      <nav className="main-nav" aria-label="主导航">
        <button className="brand-mark" aria-label="Image2 Studio 首页"><WandSparkles size={24} strokeWidth={1.8} /></button>
        <div className="nav-cluster">
          <button className={`nav-item ${view === "studio" ? "is-active" : ""}`} onClick={() => setView("studio")} title="创作"><Sparkles size={20} /><span>创作</span></button>
          <button className={`nav-item ${view === "sessions" ? "is-active" : ""}`} onClick={() => setView("sessions")} title="会话历史"><History size={20} /><span>历史</span></button>
          <button className={`nav-item ${view === "requests" ? "is-active" : ""}`} onClick={() => setView("requests")} title="请求记录"><ScrollText size={20} /><span>记录</span></button>
          <button className="nav-item" onClick={() => setIsSettingsOpen(true)} title="设置"><Settings size={20} /><span>设置</span></button>
        </div>
        <div className="nav-foot">
          <button className="nav-item" onClick={() => openExternalLink(githubRepositoryUrl)} title="在浏览器中打开 GitHub 仓库"><Github size={20} /><span>GitHub</span></button>
        </div>
      </nav>

      {view === "studio" && <>
      {!isSessionRailCollapsed && <aside className="session-rail">
        <header className="rail-heading">
          <div><p className="eyebrow">CURRENT SESSION</p><h2>本次会话请求</h2></div>
          <div className="rail-actions"><span>{activeSession?.tasks.length ?? 0} 个</span><button className="icon-button" onClick={() => setIsSessionRailCollapsed(true)} title="收起会话栏"><PanelLeftClose size={17} /></button></div>
        </header>
        <button className="new-session" onClick={newSession}><Plus size={16} />新建会话</button>
        <div className="session-list session-task-list">
          {activeSession?.tasks.length ? activeSession.tasks.map((task) => <TaskRow key={task.id} task={task} active={task.id === activeTask?.id} onClick={() => selectTask(task)} onCopy={() => copyPrompt(task.prompt)} onDelete={() => { const attemptId = task.attempts.at(-1)?.id; if (attemptId) void deleteRequestLog(attemptId); }} />) : <div className="empty-session"><WandSparkles size={20} /><p>提交后的每次请求都会记录在这里</p></div>}
        </div>
      </aside>}
      {isSessionRailCollapsed && <button className="collapsed-session-rail" onClick={() => setIsSessionRailCollapsed(false)} title="展开本次会话请求"><PanelLeftOpen size={18} /></button>}

      <section className="workspace">
        <header className="workspace-header">
          <div><p className="eyebrow">CREATIVE WORKBENCH</p><h1>创作工作台</h1></div>
          <div className="header-meta"><span><ModeIcon size={15} /> 当前模式：{currentMode.label}</span><span><SlidersHorizontal size={15} /> 使用模型：{providerCapabilities.model}</span><span className="output-location" title={`输出地址：${outputLocationLabel}`}><FolderOpen size={15} /> 输出地址：{outputLocationLabel}</span></div>
        </header>

        <div className="mode-switch" role="tablist" aria-label="创作模式">
          {(Object.keys(modeMeta) as CreationMode[]).map((mode) => {
            const Icon = modeMeta[mode].icon;
            return <button key={mode} role="tab" aria-selected={draft.mode === mode} className={draft.mode === mode ? "is-selected" : ""} onClick={() => changeMode(mode)}><Icon size={17} />{modeMeta[mode].label}</button>;
          })}
        </div>

        <div className="composer-card">
          <div className="composer-heading"><div><Sparkles size={19} /><h2>{currentMode.label}参数</h2></div><span>标准模式</span></div>
          <label className="prompt-field"><span>创作指令</span><textarea value={draft.prompt} onChange={(event) => updateDraft({ prompt: event.target.value })} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submitTask(); } }} placeholder="描述你想要生成或修改的画面..." rows={4} /><small>{draft.prompt.length} / 4000</small></label>

          {draft.mode !== "generate" && <div className="asset-inputs">
            <input ref={sourceInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff" onChange={(event) => { void handleAssetChange("sourceAsset", event.target.files?.[0]); event.currentTarget.value = ""; }} />
            <AssetStrip label="源图" helper={draft.mode === "inpaint" ? "选择需要局部编辑的图片" : "选择需要修改的图片"} asset={draft.sourceAsset} onChoose={() => sourceInputRef.current?.click()} onClear={() => replaceAsset("sourceAsset")} onView={draft.sourceAsset?.previewUrl ? () => setImageViewer({ asset: draft.sourceAsset!, label: "源图" }) : undefined} disabled={isImportingAsset} />
            {draft.mode === "inpaint" && <>
              <input ref={maskInputRef} className="visually-hidden" type="file" accept="image/png" onChange={(event) => { void handleAssetChange("maskAsset", event.target.files?.[0]); event.currentTarget.value = ""; }} />
              <AssetStrip label="蒙版" helper="使用透明 PNG 标记需要重绘的区域" asset={draft.maskAsset} onChoose={() => maskInputRef.current?.click()} onClear={() => replaceAsset("maskAsset")} disabled={isImportingAsset} />
              <button className="open-mask-editor" onClick={() => setIsMaskEditorOpen(true)} disabled={!draft.sourceAsset?.previewUrl || isImportingAsset} title={draft.sourceAsset?.previewUrl ? "在画布中涂抹需要重绘的区域" : "请先选择当前可预览的源图"}><Paintbrush size={16} />打开选区编辑器</button>
            </>}
          </div>}

          {draft.mode === "generate" && <div className="field-block"><div className="field-label"><span>画面比例</span><small>按模型能力自动过滤尺寸</small></div><div className="ratio-grid">
            {(["1:1", "2:3", "3:2", "auto"] as const).map((ratio) => <button key={ratio} className={`ratio-choice ${draft.ratio === ratio ? "is-selected" : ""}`} onClick={() => { setIsCustomSizeSelected(false); updateDraft({ ratio, size: sizesByRatio[ratio][0] }); }}><span className={`ratio-glyph ratio-${ratio.replace(":", "-")}`} /> <b>{ratio === "auto" ? "自适应" : ratio}</b></button>)}
          </div></div>}

          <div className="field-block split-field"><label><span>尺寸规格</span><div className="select-wrap"><select value={isCustomSizeSelected ? customSizeOption : draft.size} onChange={(event) => selectSize(event.target.value)}>{availableSizes.map((size) => <option key={size}>{size}</option>)}<option value={customSizeOption}>自定义尺寸</option></select><ChevronDown size={16} /></div><small className="field-hint">预设最大 2K，或按规则自定义宽高</small>{isCustomSizeSelected && <div className="custom-size-inputs"><label><span>宽</span><input type="number" inputMode="numeric" min={minimumImageEdge} max={maximumImageEdge} step="16" value={customWidth} onChange={(event) => updateCustomSize(event.target.value, customHeight)} /></label><span>×</span><label><span>高</span><input type="number" inputMode="numeric" min={minimumImageEdge} max={maximumImageEdge} step="16" value={customHeight} onChange={(event) => updateCustomSize(customWidth, event.target.value)} /></label></div>}{isCustomSizeSelected && <small className={`field-hint custom-size-hint ${customSizeError ? "is-error" : ""}`}>{customSizeError ?? `有效尺寸：${draft.size}`}</small>}</label><label><span>输出格式</span><div className="format-choice">{(["png", "jpeg", "webp"] as const).map((format) => <button key={format} className={draft.format === format ? "is-selected" : ""} onClick={() => updateDraft({ format })}>{format.toUpperCase()}</button>)}</div></label></div>

          <div className="field-block"><div className="field-label"><span>生成质量</span></div><div className="quality-choice">{(["auto", "standard", "hd"] as const).map((quality) => <button key={quality} className={draft.quality === quality ? "is-selected" : ""} onClick={() => updateDraft({ quality })}>{quality === "auto" ? "自动" : quality === "standard" ? "标准" : "高清"}</button>)}</div></div>

          <div className="composer-footer"><div className="provider-note"><span className={`status-dot ${providerCapabilities.credentialsConfigured ? "is-ready" : ""}`} />{providerCapabilities.credentialsConfigured ? providerCapabilities.remoteRequestsMessage : "请在设置中配置 API Key"}</div><button className="submit-button" onClick={submitTask} disabled={hasRunningTask}><ModeIcon size={18} />{hasRunningTask ? "任务进行中" : currentMode.action}</button></div>
        </div>
      </section>

      <aside className="result-panel">
        <div className="result-heading"><div className="result-title"><span className="result-icon"><ImagePlus size={21} /></span><div><h2>AI 生成结果</h2><p>{activeTask ? `${modeMeta[activeTask.mode].label} · ${activeTask.size} · ${activeTask.format.toUpperCase()}${elapsedLabel(activeTask) ? ` · 耗时 ${elapsedLabel(activeTask)}` : ""}` : "提交任务后，结果将在这里显示"}</p></div></div>{activeTask && <span className={`task-status status-${activeTask.status}`}>{activeTask.status === "running" && <LoaderCircle size={14} />}{getTaskStatusLabel(activeTask.status)}</span>}</div>
        <div className="result-stage">
          {!activeTask && <EmptyResult />}
          {activeTask?.status === "running" && <LoadingResult />}
          {activeTask?.status === "failed" && <FailedResult task={activeTask} onRetry={() => retryTask(activeTask)} />}
          {activeTask?.status === "succeeded" && (resultAsset?.previewUrl ? <ResultImageStage mode={resultPreviewMode} source={sourceAsset} result={resultAsset} onPreviewModeChange={setResultPreviewMode} onOpenImage={setImageViewer} /> : <ResultAssetUnavailable />)}
        </div>
        {activeTask?.status === "succeeded" && <div className="result-actions"><button className="action-button" onClick={() => void downloadResult()} disabled={!resultAsset?.previewUrl || isExportingResult} title={resultAsset?.previewUrl ? "下载结果" : "等待结果资产落盘"}><Download size={17} />{isExportingResult ? "保存中" : "下载"}</button><button className="action-button" onClick={() => continueEditing("edit")} disabled={!resultAsset} title={resultAsset ? "将结果作为源图继续编辑" : "等待结果资产落盘"}><ImagePlus size={17} />继续编辑</button><button className="action-button" onClick={() => continueEditing("inpaint")} disabled={!resultAsset} title={resultAsset ? "将结果带入局部编辑" : "等待结果资产落盘"}><Paintbrush size={17} />局部编辑</button></div>}
        {canCompareImages && <div className="result-preview-switch preview-switch" aria-label="结果查看方式"><button className={resultPreviewMode === "result" ? "is-selected" : ""} onClick={() => setResultPreviewMode("result")}>结果</button><button className={resultPreviewMode === "source" ? "is-selected" : ""} onClick={() => setResultPreviewMode("source")}>原图</button><button className={resultPreviewMode === "compare" ? "is-selected" : ""} onClick={() => setResultPreviewMode("compare")}>对比</button></div>}
        <div className="result-footer"><FolderOpen size={16} /><span title={outputFooterLabel}>{outputFooterLabel}</span></div>
      </aside>
      </>}

      {view === "sessions" && <SessionsPage sessions={sessions} selectedSessionId={selectedHistorySessionId} onSelect={setSelectedHistorySessionId} onOpen={openSession} onOpenTask={(session, task) => { openSession(session); selectTask(task, session.id); }} onDelete={deleteSession} onNew={newSession} />}
      {view === "requests" && <RequestLogsPage logs={requestLogs} isLoading={isRequestLogsLoading} onRefresh={() => void refreshRequestLogs()} onDelete={(attemptId) => void deleteRequestLog(attemptId)} onOpen={(sessionId, taskId) => { const session = sessions.find((item) => item.id === sessionId); const task = session?.tasks.find((item) => item.id === taskId); if (!session || !task) return; openSession(session); selectTask(task, session.id); }} />}

      {isSettingsOpen && <SettingsOverlay settings={appSettings} onSettingsChange={saveWebSettings} onClose={() => setIsSettingsOpen(false)} onToast={setToast} />}
      {isMaskEditorOpen && draft.sourceAsset?.previewUrl && <MaskEditorOverlay source={draft.sourceAsset} initialMask={draft.maskAsset} onClose={() => setIsMaskEditorOpen(false)} onSave={saveMaskAsset} />}
      {imageViewer && <ImageViewerOverlay asset={imageViewer.asset} label={imageViewer.label} onClose={() => setImageViewer(null)} />}
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </main>
  );
}

function TaskRow({ task, active, onClick, onCopy, onDelete }: { task: StudioTask; active: boolean; onClick: () => void; onCopy: () => void; onDelete?: () => void }) {
  const Icon = modeMeta[task.mode].icon;
  return <article className={`task-row ${active ? "is-active" : ""}`} role="button" tabIndex={0} aria-label={`打开${modeMeta[task.mode].label}请求：${task.prompt}`} onClick={onClick} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } }}><div className="task-icon"><Icon size={17} /></div><div className="task-content"><div className="task-topline"><span>{modeMeta[task.mode].label}</span><time>{displayTime(task.createdAt)}</time></div><p title={task.prompt}>{task.prompt}</p><div className="task-meta"><span>{task.size}</span><span>{task.quality === "hd" ? "高清" : task.quality === "standard" ? "标准" : "自动"}</span><span>{task.attempts.length} 次尝试</span></div></div><div className="task-actions"><button className="icon-button task-copy" onClick={(event) => { event.stopPropagation(); onCopy(); }} title="复制提示词"><Copy size={16} /></button>{onDelete && <button className="icon-button danger-button task-delete" onClick={(event) => { event.stopPropagation(); onDelete(); }} title="删除本次请求"><Trash2 size={16} /></button>}</div></article>;
}

function elapsedLabel(task: StudioTask) {
  if (!task.completedAt) return "";
  const startedAt = task.attempts.at(-1)?.createdAt ?? task.createdAt;
  const milliseconds = Math.max(0, new Date(task.completedAt).getTime() - new Date(startedAt).getTime());
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function formatAssetSize(byteLength: number) {
  if (byteLength < 1024 * 1024) return `${Math.max(1, Math.round(byteLength / 1024))} KB`;
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}

function AssetStrip({ label, helper, asset, onChoose, onClear, onView, disabled }: { label: string; helper: string; asset?: LocalAsset; onChoose: () => void; onClear: () => void; onView?: () => void; disabled: boolean }) {
  return <div className={`source-strip ${asset ? "has-asset" : ""}`}>
    {asset?.previewUrl ? <img className="asset-preview" src={asset.previewUrl} alt="" /> : <span className="source-visual"><FileImage size={22} /></span>}
    <div>
      <b>{asset ? asset.name : `选择${label}`}</b>
      <small>{asset ? `${formatAssetSize(asset.byteLength)} · ${asset.mediaType || "image"}` : helper}</small>
    </div>
    {onView && <button className="icon-button" onClick={onView} title={`查看${label}`}><ZoomIn size={16} /></button>}
    {asset && <button className="icon-button" onClick={onClear} title={`移除${label}`} disabled={disabled}><X size={16} /></button>}
    <button className="icon-button" onClick={onChoose} title={asset ? `替换${label}` : `选择${label}`} disabled={disabled}><Upload size={17} /></button>
  </div>;
}

function PreviewImage({ asset, label, onOpen }: { asset: LocalAsset; label: string; onOpen: (state: { asset: LocalAsset; label: string }) => void }) {
  if (!asset.previewUrl) return null;
  return <button className="image-preview-button" onClick={() => onOpen({ asset, label })} title={`放大查看${label}`}>
    <img className="result-image" src={asset.previewUrl} alt={label} />
    <span className="image-preview-affordance"><ZoomIn size={18} />放大查看</span>
  </button>;
}

function ResultImageStage({ mode, source, result, onPreviewModeChange, onOpenImage }: { mode: "result" | "source" | "compare"; source?: LocalAsset; result: LocalAsset; onPreviewModeChange: (mode: "result" | "source" | "compare") => void; onOpenImage: (state: { asset: LocalAsset; label: string }) => void }) {
  const canCompare = Boolean(source?.previewUrl);
  const resolvedMode = canCompare ? mode : "result";

  useEffect(() => {
    if (!canCompare && mode !== "result") onPreviewModeChange("result");
  }, [canCompare, mode, onPreviewModeChange]);

  if (resolvedMode === "compare" && source?.previewUrl) {
    return <div className="image-compare-grid"><div><span>原图</span><PreviewImage asset={source} label="原图" onOpen={onOpenImage} /></div><div><span>生成结果</span><PreviewImage asset={result} label="生成结果" onOpen={onOpenImage} /></div></div>;
  }

  const asset = resolvedMode === "source" && source?.previewUrl ? source : result;
  return <PreviewImage asset={asset} label={resolvedMode === "source" ? "原图" : "生成结果"} onOpen={onOpenImage} />;
}

function ImageViewerOverlay({ asset, label, onClose }: { asset: LocalAsset; label: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [baseImageSize, setBaseImageSize] = useState<{ width: number; height: number } | null>(null);
  const dialogRef = useModalDialog(onClose);

  function zoomBy(factor: number) {
    setZoom((current) => Math.max(0.25, Math.min(4, Number((current * factor).toFixed(2)))));
  }

  const image = <img src={asset.previewUrl} alt={label} onLoad={(event) => {
    const { clientWidth, clientHeight } = event.currentTarget;
    if (!baseImageSize && clientWidth > 0 && clientHeight > 0) setBaseImageSize({ width: clientWidth, height: clientHeight });
  }} />;

  return <div className="overlay image-viewer-overlay" role="dialog" aria-modal="true" aria-label={`${label}放大查看`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="image-viewer-card"><header><div><p className="eyebrow">IMAGE PREVIEW</p><h2>{label}</h2></div><div className="image-viewer-actions"><button className="icon-button" onClick={() => zoomBy(1 / 1.25)} disabled={zoom <= 0.25} title="缩小"><ZoomOut size={18} /></button><button className="viewer-zoom-value" onClick={() => setZoom(1)} title="适配查看">{Math.round(zoom * 100)}%</button><button className="icon-button" onClick={() => zoomBy(1.25)} disabled={zoom >= 4} title="放大"><ZoomIn size={18} /></button><button className="icon-button" onClick={onClose} title="关闭" data-dialog-autofocus><X size={19} /></button></div></header><div className="image-viewer-canvas" onWheel={(event) => { event.preventDefault(); zoomBy(event.deltaY > 0 ? 1 / 1.15 : 1.15); }}>{baseImageSize ? <div className="image-viewer-image-frame" style={{ width: baseImageSize.width * zoom, height: baseImageSize.height * zoom }}>{image}</div> : image}</div></section></div>;
}

function EmptyResult() { return <div className="empty-result"><div className="empty-result-icon"><ImagePlus size={38} /></div><h3>等待第一张作品</h3><p>输入创作指令后，结果会保存在当前会话中。</p></div>; }
function LoadingResult() { return <div className="loading-result"><LoaderCircle size={32} /><h3>正在构思画面</h3><p>任务已安全写入会话，完成后会自动显示。</p></div>; }
function FailedResult({ task, onRetry }: { task: StudioTask; onRetry: () => void }) {
  const latestAttempt = task.attempts.at(-1);
  const canRetry = latestAttempt?.retryable ?? true;
  return <div className="failed-result"><div className="failed-mark"><X size={26} /></div><h3>本次生成未完成</h3><p>{latestAttempt?.error ?? "网络或服务暂时不可用。原始输入已保留，可在原位置重试。"}</p>{canRetry && <button className="retry-button" onClick={onRetry}><RotateCcw size={16} />重试（第 {task.attempts.length + 1} 次）</button>}</div>;
}

function ResultAssetUnavailable() {
  return <div className="result-asset-unavailable"><div className="empty-result-icon"><ImagePlus size={38} /></div><h3>等待结果资产落盘</h3><p>任务状态已完成，但当前 Provider 尚未返回可保存的结果图片。下载、继续编辑和局部编辑会在结果资产接入后启用。</p></div>;
}

type MaskPoint = { x: number; y: number };
type MaskOperation = { kind: "stroke"; tool: "brush" | "eraser"; size: number; points: MaskPoint[] } | { kind: "clear" } | { kind: "invert" };

function MaskEditorOverlay({ source, initialMask, onClose, onSave }: { source: LocalAsset; initialMask?: LocalAsset; onClose: () => void; onSave: (blob: Blob) => Promise<void> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const baseMaskRef = useRef<HTMLImageElement | null>(null);
  const operationsRef = useRef<MaskOperation[]>([]);
  const activeStrokeRef = useRef<Extract<MaskOperation, { kind: "stroke" }> | null>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [brushSize, setBrushSize] = useState(72);
  const [tool, setTool] = useState<"brush" | "eraser">("brush");
  const [historyIndex, setHistoryIndex] = useState(0);
  const [hasMaskSelection, setHasMaskSelection] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState<"overlay" | "source" | "mask">("overlay");
  const [maskRevision, setMaskRevision] = useState(0);
  const dialogRef = useModalDialog(onClose);

  function drawStroke(context: CanvasRenderingContext2D, operation: Extract<MaskOperation, { kind: "stroke" }>, scale: number) {
    if (!operation.points.length) return;
    context.save();
    context.globalCompositeOperation = operation.tool === "brush" ? "destination-out" : "source-over";
    context.strokeStyle = "rgb(10, 16, 14)";
    context.fillStyle = context.strokeStyle;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = operation.size * scale;
    context.beginPath();
    context.moveTo(operation.points[0].x * scale, operation.points[0].y * scale);
    for (const point of operation.points.slice(1)) context.lineTo(point.x * scale, point.y * scale);
    context.stroke();
    context.beginPath();
    context.arc(operation.points[0].x * scale, operation.points[0].y * scale, operation.size * scale / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function renderMask(canvas: HTMLCanvasElement, operations = operationsRef.current.slice(0, historyIndex)) {
    const context = canvas.getContext("2d");
    if (!context || !sourceSize.width || !sourceSize.height) return;
    const scale = canvas.width / sourceSize.width;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (baseMaskRef.current) {
      context.drawImage(baseMaskRef.current, 0, 0, canvas.width, canvas.height);
    } else {
      context.fillStyle = "rgb(10, 16, 14)";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    for (const operation of operations) {
      if (operation.kind === "clear") {
        context.globalCompositeOperation = "source-over";
        context.fillStyle = "rgb(10, 16, 14)";
        context.fillRect(0, 0, canvas.width, canvas.height);
      } else if (operation.kind === "invert") {
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let offset = 3; offset < imageData.data.length; offset += 4) imageData.data[offset] = 255 - imageData.data[offset];
        context.putImageData(imageData, 0, 0);
      } else {
        drawStroke(context, operation, scale);
      }
    }
  }

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = canvasRef.current;
      if (!canvas) return;
      imageRef.current = image;
      operationsRef.current = [];
      baseMaskRef.current = null;
      canvas.width = width;
      canvas.height = height;
      setSourceSize({ width: image.naturalWidth, height: image.naturalHeight });
      setCanvasSize({ width, height });
      setHistoryIndex(0);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      if (!initialMask?.previewUrl) {
        setMaskRevision((current) => current + 1);
        return;
      }
      const mask = new Image();
      mask.onload = () => {
        baseMaskRef.current = mask;
        setMaskRevision((current) => current + 1);
      };
      mask.src = initialMask.previewUrl;
    };
    image.src = source.previewUrl ?? "";
    return () => { image.onload = null; };
  }, [source.previewUrl, initialMask?.previewUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width || !canvas.height || !sourceSize.width || !sourceSize.height) {
      setHasMaskSelection(false);
      return;
    }
    renderMask(canvas);
    const context = canvas.getContext("2d");
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
    setHasMaskSelection(Boolean(pixels?.some((_, offset) => offset % 4 === 3 && pixels[offset] < 255)));
  // Canvas state is held in refs; these values deliberately trigger a replay.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize, historyIndex, maskRevision, sourceSize]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") setIsSpaceDown(true);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setHistoryIndex((current) => event.shiftKey ? Math.min(operationsRef.current.length, current + 1) : Math.max(0, current - 1));
      }
      if (event.key === "0") { setZoom(1); setPan({ x: 0, y: 0 }); }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === "Space") setIsSpaceDown(false); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, []);

  function commitOperation(operation: MaskOperation) {
    operationsRef.current = [...operationsRef.current.slice(0, historyIndex), operation];
    setHistoryIndex(operationsRef.current.length);
  }

  function pointForEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !sourceSize.width || !sourceSize.height) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(sourceSize.width, (event.clientX - bounds.left) * (sourceSize.width / bounds.width))),
      y: Math.max(0, Math.min(sourceSize.height, (event.clientY - bounds.top) * (sourceSize.height / bounds.height))),
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button === 1 || isSpaceDown) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panStartRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      return;
    }
    if (event.button !== 0) return;
    const point = pointForEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activeStrokeRef.current = { kind: "stroke", tool, size: brushSize, points: [point] };
    const canvas = canvasRef.current;
    if (canvas) renderMask(canvas, [...operationsRef.current.slice(0, historyIndex), activeStrokeRef.current]);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (panStartRef.current) {
      setPan({ x: panStartRef.current.panX + event.clientX - panStartRef.current.x, y: panStartRef.current.panY + event.clientY - panStartRef.current.y });
      return;
    }
    const point = pointForEvent(event);
    if (!point || !activeStrokeRef.current) return;
    activeStrokeRef.current.points.push(point);
    const canvas = canvasRef.current;
    if (canvas) renderMask(canvas, [...operationsRef.current.slice(0, historyIndex), activeStrokeRef.current]);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (panStartRef.current) { panStartRef.current = null; return; }
    if (activeStrokeRef.current) commitOperation(activeStrokeRef.current);
    activeStrokeRef.current = null;
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!canvasSize.width) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextZoom = Math.max(0.1, Math.min(8, zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    setPan({ x: pointerX - (pointerX - pan.x) * (nextZoom / zoom), y: pointerY - (pointerY - pan.y) * (nextZoom / zoom) });
    setZoom(nextZoom);
  }

  async function exportMask() {
    if (!sourceSize.width || !sourceSize.height || !hasMaskSelection) return;
    const mask = document.createElement("canvas");
    mask.width = sourceSize.width;
    mask.height = sourceSize.height;
    renderMask(mask);
    setIsSaving(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) => mask.toBlob(resolve, "image/png"));
      if (blob) await onSave(blob);
    } finally {
      setIsSaving(false);
    }
  }

  const layerClass = `mask-canvas-layer preview-${previewMode}`;
  return <div className="overlay mask-editor-overlay" role="dialog" aria-modal="true" aria-label="选区编辑器"><section ref={dialogRef} className="overlay-card mask-editor-card"><header><div><p className="eyebrow">LOCAL INPAINT MASK</p><h2>选区编辑器</h2></div><button className="icon-button" onClick={onClose} title="关闭" data-dialog-autofocus><X size={19} /></button></header><div className="mask-editor-toolbar"><div className="tool-group"><button className={tool === "brush" ? "is-selected" : ""} onClick={() => setTool("brush")} title="涂抹需要重绘的区域"><Brush size={17} />涂抹</button><button className={tool === "eraser" ? "is-selected" : ""} onClick={() => setTool("eraser")} title="恢复不需要重绘的区域"><Paintbrush size={17} />橡皮</button></div><label>笔刷 <input type="range" min="1" max="500" step="1" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /><b>{brushSize}px</b></label><div className="editor-history"><button className="icon-button" onClick={() => setHistoryIndex((current) => Math.max(0, current - 1))} disabled={historyIndex === 0} title="撤销"><Undo2 size={17} /></button><button className="icon-button" onClick={() => setHistoryIndex((current) => Math.min(operationsRef.current.length, current + 1))} disabled={historyIndex === operationsRef.current.length} title="重做"><Redo2 size={17} /></button><button className="icon-button" onClick={() => commitOperation({ kind: "clear" })} disabled={historyIndex === 0} title="清空选区"><X size={17} /></button><button className="icon-button" onClick={() => commitOperation({ kind: "invert" })} disabled={!canvasSize.width} title="反选蒙版"><RotateCcw size={17} /></button></div></div><div className="mask-editor-subtoolbar"><div className="preview-switch" aria-label="预览方式"><button className={previewMode === "overlay" ? "is-selected" : ""} onClick={() => setPreviewMode("overlay")}>叠加</button><button className={previewMode === "source" ? "is-selected" : ""} onClick={() => setPreviewMode("source")}>原图</button><button className={previewMode === "mask" ? "is-selected" : ""} onClick={() => setPreviewMode("mask")}>蒙版</button></div><div><button className="secondary-button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="适配画布（0）">适配 {Math.round(zoom * 100)}%</button></div></div><div className="mask-canvas-wrap" onWheel={handleWheel}><div className={layerClass} style={{ aspectRatio: canvasSize.width && canvasSize.height ? `${canvasSize.width} / ${canvasSize.height}` : undefined, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}><img src={source.previewUrl} alt="源图预览" draggable={false} /><canvas ref={canvasRef} className="mask-canvas" width={canvasSize.width} height={canvasSize.height} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onContextMenu={(event) => event.preventDefault()} /></div></div><footer className="mask-editor-footer"><p>不透明区域保持原图，完全透明的涂抹区域会交给模型重绘。滚轮缩放，空格或中键拖拽平移。</p><button className="submit-button compact" onClick={() => void exportMask()} disabled={!canvasSize.width || !hasMaskSelection || isSaving}>{isSaving ? "保存中" : "应用蒙版"}</button></footer></section></div>;
}

function SessionsPage({ sessions, selectedSessionId, onSelect, onOpen, onOpenTask, onDelete, onNew }: { sessions: StudioSession[]; selectedSessionId: string | null; onSelect: (sessionId: string) => void; onOpen: (session: StudioSession) => void; onOpenTask: (session: StudioSession, task: StudioTask) => void; onDelete: (sessionId: string) => void; onNew: () => void }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredSessions = normalizedQuery ? sessions.filter((session) => (
    session.title.toLocaleLowerCase().includes(normalizedQuery)
    || session.tasks.some((task) => task.prompt.toLocaleLowerCase().includes(normalizedQuery))
  )) : sessions;
  const selectedSession = filteredSessions.find((session) => session.id === selectedSessionId) ?? filteredSessions[0];

  return <section className="management-page">
    <header className="page-header"><div><p className="eyebrow">ALL SESSIONS</p><h1>会话历史</h1><p>查看每个会话的创作轨迹，或回到指定会话继续工作。</p></div><button className="submit-button" onClick={onNew}><Plus size={17} />新建会话</button></header>
    <div className="history-toolbar page-toolbar"><div className="search-box"><History size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或提示词" /></div><span>{filteredSessions.length} 个会话</span></div>
    <div className="sessions-page-layout">
      <div className="history-list page-history-list">{filteredSessions.length ? filteredSessions.map((session) => <button key={session.id} className={session.id === selectedSession?.id ? "is-selected" : ""} onClick={() => onSelect(session.id)}><span className="history-preview"><Images size={21} /></span><span><b>{session.title}</b><small>{session.tasks.at(-1)?.prompt ?? "等待第一条指令"}</small><em>{session.tasks.length} 个任务 · {relativeTime(session.updatedAt)}</em></span></button>) : <div className="history-none">{normalizedQuery ? "没有匹配的会话" : "尚无历史会话"}</div>}</div>
      <section className="session-detail">{selectedSession ? <><div className="session-detail-heading"><div><p className="eyebrow">SESSION DETAIL</p><h2>{selectedSession.title}</h2><span>{selectedSession.tasks.length} 个任务 · 更新于 {relativeTime(selectedSession.updatedAt)}</span></div><div className="detail-actions"><button className="secondary-button" onClick={() => onOpen(selectedSession)}><ArrowUpRight size={16} />打开会话</button><button className="icon-button danger-button" onClick={() => onDelete(selectedSession.id)} title="删除会话"><Trash2 size={16} /></button></div></div><div className="session-detail-list">{selectedSession.tasks.length ? selectedSession.tasks.map((task) => <TaskRow key={task.id} task={task} active={false} onClick={() => onOpenTask(selectedSession, task)} onCopy={() => void navigator.clipboard.writeText(task.prompt)} />) : <div className="history-none">该会话尚未提交请求</div>}</div></> : <div className="history-none">选择一个会话查看详情</div>}</section>
    </div>
  </section>;
}

function RequestLogsPage({ logs, isLoading, onRefresh, onDelete, onOpen }: { logs: RequestLogRecord[]; isLoading: boolean; onRefresh: () => void; onDelete: (attemptId: string) => void; onOpen: (sessionId: string, taskId: string) => void }) {
  return <section className="management-page">
    <header className="page-header"><div><p className="eyebrow">REQUEST AUDIT</p><h1>请求记录</h1><p>每次提交与重试都会保存时间、接口、模型、结果状态和错误信息。</p></div><button className="icon-button refresh-button" onClick={onRefresh} disabled={isLoading} title={isLoading ? "正在刷新请求记录" : "刷新请求记录"}><RefreshCw size={18} className={isLoading ? "is-spinning" : ""} /></button></header>
    <div className="request-log-summary"><span>{isLoading ? "正在读取记录" : `共 ${logs.length} 条请求记录`}</span><span>最多显示最近 500 条</span></div>
    <div className="request-table-wrap"><table className="request-table"><thead><tr><th>时间</th><th>会话 / 指令</th><th>接口</th><th>模型</th><th>结果</th><th>状态</th><th>错误</th><th aria-label="操作" /></tr></thead><tbody>{logs.length ? logs.map((log) => <tr key={log.attemptId}><td><time>{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(log.createdAt))}</time></td><td><b>{log.sessionTitle}</b><span>{log.prompt}</span></td><td><code>{log.apiBaseUrl ?? "未记录"}</code></td><td><code>{log.model ?? "未记录"}</code></td><td>{log.resultAsset?.name ?? (log.status === "succeeded" ? "已完成" : "-")}</td><td><span className={`task-status status-${log.status}`}>{getTaskStatusLabel(log.status)}</span></td><td>{log.error ? <span className="request-error"><b>{log.errorCode}</b>{log.error}</span> : "-"}</td><td><div className="request-actions"><button className="icon-button" onClick={() => onOpen(log.sessionId, log.taskId)} title="打开所在会话"><ArrowUpRight size={16} /></button><button className="icon-button danger-button" onClick={() => onDelete(log.attemptId)} title="删除请求记录"><Trash2 size={16} /></button></div></td></tr>) : <tr><td colSpan={8} className="request-empty">{isLoading ? "正在加载请求记录" : "尚无请求记录"}</td></tr>}</tbody></table></div>
  </section>;
}
