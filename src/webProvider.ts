import { assetToFile, browserAssetFromBlob, MAX_BROWSER_ASSET_BYTES } from "./browserStorage";
import type { CreationMode, LocalAsset } from "./types";

export interface BrowserImageRequest {
  mode: CreationMode;
  prompt: string;
  size: string;
  quality: string;
  outputFormat: string;
  sourceAsset?: LocalAsset;
  maskAsset?: LocalAsset;
}

export interface BrowserProviderError {
  code: string;
  message: string;
  retryable: boolean;
}

const model = "gpt-image-2";
const minImageEdge = 512;
const maxImageEdge = 2560;
const minImagePixels = 655_360;
const maxImagePixels = 2560 * 1440;
const supportedFormats = new Set(["png", "jpeg", "webp"]);

export async function submitBrowserImageTask(request: BrowserImageRequest, settings: { apiBaseUrl: string; apiKey: string }): Promise<LocalAsset> {
  if (!settings.apiKey.trim()) throw providerError("missing_credentials", "请先在设置中保存 API Key。", false);
  if (!request.prompt.trim()) throw providerError("invalid_request", "创作指令不能为空。", false);
  const size = validateRequestOptions(request);
  const endpoint = createEndpoint(settings.apiBaseUrl, request.mode);
  const headers = { Authorization: `Bearer ${settings.apiKey.trim()}` };
  const response = request.mode === "generate"
    ? await requestProvider(endpoint, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: request.prompt.trim(),
        size,
        quality: qualityForProvider(request.quality),
        output_format: request.outputFormat,
      }),
    })
    : await submitEdit(endpoint, headers, request);

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw providerError("invalid_response", "无法读取图片服务的响应数据。", true);
  }
  if (!response.ok) {
    const message = responseMessage(text) || `图像服务请求失败（${response.status}）。`;
    throw providerError(`http_${response.status}`, message, response.status === 429 || response.status >= 500);
  }
  let payload: { data?: Array<{ b64_json?: string }> };
  try {
    payload = JSON.parse(text) as { data?: Array<{ b64_json?: string }> };
  } catch {
    throw providerError("invalid_response", "图像服务返回了无法识别的数据。", true);
  }
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded) throw providerError("invalid_response", "图像服务未返回可保存的图片数据。", true);
  const blob = base64ToBlob(encoded, mediaTypeForFormat(request.outputFormat));
  return browserAssetFromBlob(blob, `image-studio-${Date.now()}.${extensionForFormat(request.outputFormat)}`);
}

async function submitEdit(endpoint: string, headers: Record<string, string>, request: BrowserImageRequest) {
  if (!request.sourceAsset) throw providerError("invalid_request", "编辑需要先选择源图。", false);
  if (request.mode === "inpaint" && !request.maskAsset) throw providerError("invalid_request", "局部编辑需要源图和蒙版。", false);
  const sourceFile = await assetToFile(request.sourceAsset, "source");
  const maskFile = request.mode === "inpaint" && request.maskAsset
    ? await assetToFile(request.maskAsset, "mask.png")
    : undefined;
  if (maskFile) await validateMask(sourceFile, maskFile);
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", request.prompt.trim());
  form.set("size", request.size.replaceAll(" ", ""));
  form.set("quality", qualityForProvider(request.quality));
  form.set("output_format", request.outputFormat);
  form.set("image", sourceFile);
  if (maskFile) form.set("mask", maskFile);
  return requestProvider(endpoint, { method: "POST", headers, body: form });
}

function validateRequestOptions(request: BrowserImageRequest) {
  const match = request.size.match(/^(\d+)\s*x\s*(\d+)$/i);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!match || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw providerError("invalid_request", "图片尺寸格式无效。", false);
  }
  const pixels = width * height;
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (width % 16 || height % 16 || width < minImageEdge || height < minImageEdge || width > maxImageEdge || height > maxImageEdge || pixels < minImagePixels || pixels > maxImagePixels || ratio > 3) {
    throw providerError("invalid_request", "图片尺寸不符合当前 2K 生成规则。", false);
  }
  if (!supportedFormats.has(request.outputFormat)) {
    throw providerError("invalid_request", "输出格式仅支持 PNG、JPEG 或 WebP。", false);
  }
  if (!new Set(["auto", "standard", "hd"]).has(request.quality)) {
    throw providerError("invalid_request", "生成质量参数无效。", false);
  }
  return `${width}x${height}`;
}

function createEndpoint(apiBaseUrl: string, mode: CreationMode) {
  let url: URL;
  try {
    url = new URL(apiBaseUrl.trim());
  } catch {
    throw providerError("invalid_endpoint", "API 接口地址格式无效。", false);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw providerError("invalid_endpoint", "API 接口地址必须是无查询参数的 HTTPS 地址。", false);
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${mode === "generate" ? "images/generations" : "images/edits"}`;
  return url.toString();
}

async function requestProvider(endpoint: string, options: RequestInit) {
  try {
    return await fetch(endpoint, options);
  } catch {
    throw providerError("network_error", "无法连接图片服务。请确认接口地址可访问且允许跨域请求。", true);
  }
}

async function validateMask(source: File, mask: File) {
  if (mask.type !== "image/png") {
    throw providerError("invalid_mask", "局部编辑蒙版必须是 PNG 图片。", false);
  }
  const [sourceImage, maskImage] = await Promise.all([loadImage(source), loadImage(mask)]);
  if (sourceImage.width !== maskImage.width || sourceImage.height !== maskImage.height) {
    throw providerError("invalid_mask", "蒙版尺寸必须与源图完全一致。", false);
  }
  const canvas = document.createElement("canvas");
  canvas.width = maskImage.width;
  canvas.height = maskImage.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw providerError("invalid_mask", "当前浏览器无法读取蒙版像素。", false);
  context.drawImage(maskImage, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) return;
  }
  throw providerError("invalid_mask", "蒙版没有透明选区，请在选区编辑器中涂抹后再提交。", false);
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(providerError("invalid_image", "无法读取源图或蒙版图片。", false));
    };
    image.src = url;
  });
}

function qualityForProvider(quality: string) {
  return quality === "standard" ? "medium" : quality === "hd" ? "high" : "auto";
}

function responseMessage(text: string) {
  try {
    const body = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return body.error?.message ?? body.message;
  } catch {
    return text.trim().slice(0, 280);
  }
}

function extensionForFormat(format: string) {
  return format === "jpeg" ? "jpg" : format;
}

function mediaTypeForFormat(format: string) {
  return format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
}

function base64ToBlob(encoded: string, type: string) {
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const estimatedByteLength = Math.floor((encoded.length * 3) / 4) - padding;
  if (estimatedByteLength > MAX_BROWSER_ASSET_BYTES) {
    throw providerError("invalid_response", "生成图片超过浏览器可安全保存的 8 MB 上限。", true);
  }
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    throw providerError("invalid_response", "图片服务返回了无效的图片数据。", true);
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type });
}

function providerError(code: string, message: string, retryable: boolean): BrowserProviderError {
  return { code, message, retryable };
}
