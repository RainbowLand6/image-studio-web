export type CreationMode = "generate" | "edit" | "inpaint";
export type TaskStatus = "idle" | "queued" | "running" | "succeeded" | "failed";

export interface LocalAsset {
  path: string;
  name: string;
  mediaType: string;
  byteLength: number;
  previewUrl?: string;
}

export interface TaskAttempt {
  id: string;
  status: TaskStatus;
  createdAt: string;
  apiBaseUrl?: string;
  model?: string;
  error?: string;
  errorCode?: string;
  retryable?: boolean;
}

export interface StudioTask {
  id: string;
  prompt: string;
  mode: CreationMode;
  status: TaskStatus;
  createdAt: string;
  ratio?: Draft["ratio"];
  size: string;
  quality: string;
  format: string;
  completedAt?: string;
  sourceAsset?: LocalAsset;
  maskAsset?: LocalAsset;
  resultAsset?: LocalAsset;
  attempts: TaskAttempt[];
}

export interface StudioSession {
  id: string;
  title: string;
  updatedAt: string;
  tasks: StudioTask[];
  draft?: Draft;
}

export interface Draft {
  prompt: string;
  mode: CreationMode;
  ratio: "1:1" | "2:3" | "3:2" | "auto";
  size: string;
  quality: "auto" | "standard" | "hd";
  format: "png" | "jpeg" | "webp";
  sourceAsset?: LocalAsset;
  maskAsset?: LocalAsset;
}
