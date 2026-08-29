const GPU_PROFILE_SOURCE_URL =
  "https://github.com/clearcotelabs/clearcote-browser";
const APIFY_FINGERPRINT_SUITE_SOURCE_URL =
  "https://github.com/apify/fingerprint-suite";
const GPU_PROFILE_BUNDLE_PATH = "profiles/clearcote";
const APIFY_PROFILE_BUNDLE_PATH = "profiles/apify";
const VALID_GPU_PROFILE_BUNDLE_PATHS = new Set([
  GPU_PROFILE_BUNDLE_PATH,
  APIFY_PROFILE_BUNDLE_PATH,
]);
const MAX_GPU_PROFILE_FILE_SIZE = 512 * 1024;
const GPU_PROFILE_SCHEMA_VERSION = 2;

function isGpuProfileRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeGpuProfileText(value, maxLength = 256) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeGpuProfileValue(value, depth = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 256);
  if (Array.isArray(value)) {
    if (depth >= 3 || value.length > 64) return null;
    return value
      .map((entry) => normalizeGpuProfileValue(entry, depth + 1))
      .filter((entry) => entry !== null);
  }
  if (!isGpuProfileRecord(value) || depth >= 3) return null;
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 256)) {
    const normalized = normalizeGpuProfileValue(entry, depth + 1);
    if (normalized !== null) result[String(key).slice(0, 128)] = normalized;
  }
  return result;
}

function normalizeGpuProfileMap(value) {
  if (!isGpuProfileRecord(value)) return {};
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 256)) {
    const normalized = normalizeGpuProfileValue(entry);
    if (normalized !== null) result[String(key).slice(0, 128)] = normalized;
  }
  return result;
}

function normalizeGpuProfileSurface(value) {
  if (!isGpuProfileRecord(value)) return null;
  const parameters = normalizeGpuProfileMap(value.parameters);
  const shaderPrecision = normalizeGpuProfileMap(
    value.shader_precision || value.shaderPrecision,
  );
  const extensions = Array.isArray(value.extensions)
    ? value.extensions
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim().slice(0, 128))
        .slice(0, 256)
    : [];
  const debug = normalizeGpuProfileMap(value.debug);
  const contextAttributes = normalizeGpuProfileValue(
    value.context_attributes || value.contextAttributes,
  );
  const normalized = {
    parameters,
    shaderPrecision,
    extensions,
    debug,
    ...(contextAttributes && typeof contextAttributes === "object"
      ? { contextAttributes }
      : {}),
  };
  return Object.keys(parameters).length ||
    Object.keys(shaderPrecision).length ||
    extensions.length ||
    Object.keys(debug).length
    ? normalized
    : null;
}

function normalizeApifyVideoCard(value) {
  if (!isGpuProfileRecord(value)) return null;
  const vendor = normalizeGpuProfileText(value.vendor, 128);
  const renderer = normalizeGpuProfileText(value.renderer, 256);
  if (!vendor && !renderer) return null;
  return {
    parameters: {},
    shaderPrecision: {},
    extensions: [],
    debug: {
      VENDOR: "WebKit",
      RENDERER: "WebKit WebGL",
      ...(vendor ? { UNMASKED_VENDOR_WEBGL: vendor } : {}),
      ...(renderer ? { UNMASKED_RENDERER_WEBGL: renderer } : {}),
    },
  };
}

function normalizeGpuProfileWebGL(value, fallbackVideoCard = null) {
  const source = isGpuProfileRecord(value) ? value : {};
  const webgl1 = normalizeGpuProfileSurface(source.webgl1);
  const webgl2 = normalizeGpuProfileSurface(source.webgl2);
  const fallback = normalizeApifyVideoCard(fallbackVideoCard);
  return webgl1 || webgl2 || fallback
    ? { webgl1: webgl1 || fallback, webgl2: webgl2 || null }
    : null;
}

function normalizeGpuProfileLimits(value) {
  if (!isGpuProfileRecord(value)) return {};
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 128)) {
    const number = typeof entry === "number" ? entry : Number(entry);
    if (Number.isFinite(number) && number >= 0) {
      result[String(key).trim().slice(0, 128)] = number;
    }
  }
  return result;
}

function normalizeGpuProfileAdapter(value) {
  if (!isGpuProfileRecord(value)) return null;
  const infoSource = isGpuProfileRecord(value.info) ? value.info : {};
  const features = Array.isArray(value.features)
    ? value.features
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim().slice(0, 128))
        .slice(0, 128)
    : [];
  return {
    isFallbackAdapter:
      typeof value.is_fallback_adapter === "boolean"
        ? value.is_fallback_adapter
        : typeof value.isFallbackAdapter === "boolean"
          ? value.isFallbackAdapter
          : null,
    features,
    info: {
      vendor: normalizeGpuProfileText(infoSource.vendor),
      architecture: normalizeGpuProfileText(infoSource.architecture),
      device: normalizeGpuProfileText(infoSource.device),
      description: normalizeGpuProfileText(infoSource.description),
    },
    limits: normalizeGpuProfileLimits(value.limits),
  };
}

function normalizeGpuProfileWebGPU(value) {
  if (!isGpuProfileRecord(value)) return null;
  const adapter =
    normalizeGpuProfileAdapter(value.high_performance) ||
    normalizeGpuProfileAdapter(value.highPerformance) ||
    normalizeGpuProfileAdapter(value.low_performance) ||
    normalizeGpuProfileAdapter(value.lowPerformance) ||
    normalizeGpuProfileAdapter(value.adapter) ||
    normalizeGpuProfileAdapter(value);
  if (!adapter) return null;
  const hasAdapterData =
    adapter.features.length > 0 ||
    Object.keys(adapter.limits).length > 0 ||
    Object.values(adapter.info).some(Boolean) ||
    typeof adapter.isFallbackAdapter === "boolean";
  if (!hasAdapterData) return null;
  const preferredCanvasFormat = normalizeGpuProfileText(
    value.preferred_canvas_format || value.preferredCanvasFormat,
    32,
  );
  return {
    available: value.available !== false,
    preferredCanvasFormat,
    ...adapter,
  };
}

function normalizeGpuProfile(value) {
  if (!isGpuProfileRecord(value)) return null;
  const source = isGpuProfileRecord(value.profile) ? value.profile : value;
  let serializedLength = 0;
  try {
    serializedLength = JSON.stringify(source).length;
  } catch (error) {
    return null;
  }
  if (serializedLength > MAX_GPU_PROFILE_FILE_SIZE) return null;

  const apifyFingerprint = isGpuProfileRecord(source.fingerprint)
    ? source.fingerprint
    : null;
  const declaredSource = normalizeGpuProfileText(
    source.source || value.source,
    512,
  );
  const isApifyProfile = Boolean(
    apifyFingerprint && isGpuProfileRecord(apifyFingerprint.videoCard),
  ) ||
    declaredSource === APIFY_FINGERPRINT_SUITE_SOURCE_URL ||
    source.schema === "fingerprint-suite-profile";
  const webgl = normalizeGpuProfileWebGL(
    source.webgl,
    apifyFingerprint && apifyFingerprint.videoCard,
  );
  const webgpu = normalizeGpuProfileWebGPU(source.webgpu);
  if (!webgl || (!webgpu && !isApifyProfile)) return null;
  const meta = isGpuProfileRecord(source.meta) ? source.meta : {};
  const normalized = {
    schema:
      isApifyProfile ? "fingerprint-suite-profile" : "clearcote-profile",
    schemaVersion: GPU_PROFILE_SCHEMA_VERSION,
    source:
      declaredSource ||
      (isApifyProfile ? APIFY_FINGERPRINT_SUITE_SOURCE_URL : GPU_PROFILE_SOURCE_URL),
    id: normalizeGpuProfileText(meta.id || source.id, 128),
    gpuVendor: normalizeGpuProfileText(meta.gpu_vendor || source.gpuVendor, 64),
    gpuFamily: normalizeGpuProfileText(meta.gpu_family || source.gpuFamily, 64),
    webgl,
    webgpu: webgpu || null,
  };
  if (isApifyProfile && apifyFingerprint) {
    const navigator = normalizeGpuProfileValue(apifyFingerprint.navigator);
    const screen = normalizeGpuProfileValue(apifyFingerprint.screen);
    if (navigator && typeof navigator === "object") normalized.navigator = navigator;
    if (screen && typeof screen === "object") normalized.screen = screen;
  }
  return normalized;
}

function getGpuProfileSummary(profile) {
  const normalized = normalizeGpuProfile(profile);
  if (!normalized) return null;
  const webgpu = normalized.webgpu || {};
  const webglSurfaces = [normalized.webgl.webgl1, normalized.webgl.webgl2].filter(
    Boolean,
  ).length;
  return {
    id: normalized.id || "Imported profile",
    vendor: normalized.gpuVendor || webgpu.info?.vendor || "Unknown GPU",
    family: normalized.gpuFamily,
    webglSurfaces,
    webgpuAvailable:
      typeof webgpu.available === "boolean" ? webgpu.available : null,
    webgpuFeatures: Array.isArray(webgpu.features) ? webgpu.features.length : 0,
    webgpuLimits: Object.keys(webgpu.limits || {}).length,
  };
}

function normalizeGpuProfileIndex(value) {
  if (!isGpuProfileRecord(value) || !Array.isArray(value.profiles)) {
    return [];
  }
  return value.profiles
    .filter((entry) => isGpuProfileRecord(entry))
    .map((entry) => {
      const normalized = {
        id: normalizeGpuProfileText(entry.id, 128),
        gpuVendor: normalizeGpuProfileText(entry.gpu_vendor || entry.gpuVendor, 64),
        gpuFamily: normalizeGpuProfileText(entry.gpu_family || entry.gpuFamily, 64),
        renderer: normalizeGpuProfileText(entry.renderer, 256),
        screen: normalizeGpuProfileText(entry.screen, 32),
        hardwareConcurrency: Number.isFinite(Number(entry.hardware_concurrency))
          ? Number(entry.hardware_concurrency)
          : null,
        deviceMemory: Number.isFinite(Number(entry.device_memory))
          ? Number(entry.device_memory)
          : null,
        webgpuAvailable: entry.webgpu_available !== false,
      };
      const source = normalizeGpuProfileText(entry.source || value.source, 512);
      const bundlePath = normalizeGpuProfileText(entry.bundle_path, 128);
      if (source) normalized.source = source;
      if (bundlePath) normalized.bundlePath = bundlePath;
      if (entry.selectable === false) normalized.selectable = false;
      if (typeof entry.webgpu_profiled === "boolean") {
        normalized.webgpuProfiled = entry.webgpu_profiled;
      }
      return normalized;
    })
    .filter((entry) => entry.id && /^[A-Za-z0-9_-]+$/.test(entry.id));
}

function getGpuProfileAssetPath(profileId, bundlePath = GPU_PROFILE_BUNDLE_PATH) {
  const id = normalizeGpuProfileText(profileId, 128);
  const path = normalizeGpuProfileText(bundlePath, 128);
  return id && /^[A-Za-z0-9_-]+$/.test(id) && VALID_GPU_PROFILE_BUNDLE_PATHS.has(path)
    ? `${path}/${id}.json`
    : null;
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    GPU_PROFILE_SOURCE_URL,
    APIFY_FINGERPRINT_SUITE_SOURCE_URL,
    GPU_PROFILE_BUNDLE_PATH,
    APIFY_PROFILE_BUNDLE_PATH,
    MAX_GPU_PROFILE_FILE_SIZE,
    GPU_PROFILE_SCHEMA_VERSION,
    normalizeGpuProfile,
    getGpuProfileSummary,
    normalizeGpuProfileIndex,
    getGpuProfileAssetPath,
  };
}
