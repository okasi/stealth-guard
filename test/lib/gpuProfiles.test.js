import { expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  GPU_PROFILE_SCHEMA_VERSION,
  GPU_PROFILE_SOURCE_URL,
  APIFY_FINGERPRINT_SUITE_SOURCE_URL,
  GPU_PROFILE_BUNDLE_PATH,
  APIFY_PROFILE_BUNDLE_PATH,
  getGpuProfileAssetPath,
  getGpuProfileSummary,
  normalizeGpuProfileIndex,
  normalizeGpuProfile,
} = require("../../lib/gpuProfiles.js");

function createProfile(overrides = {}) {
  return {
    meta: { id: "intel-test", gpu_vendor: "Intel", gpu_family: "Iris" },
    webgl: {
      webgl1: {
        parameters: {
          MAX_TEXTURE_SIZE: 16384,
          ALIASED_POINT_SIZE_RANGE: [1, 1024],
        },
        shader_precision: {
          "FRAGMENT_SHADER:HIGH_FLOAT": {
            rangeMin: 127,
            rangeMax: 127,
            precision: 23,
          },
        },
        extensions: ["WEBGL_debug_renderer_info"],
        debug: {
          VENDOR: "WebKit",
          RENDERER: "WebKit WebGL",
          UNMASKED_VENDOR_WEBGL: "Google Inc. (Intel)",
          UNMASKED_RENDERER_WEBGL: "ANGLE (Intel, Iris)",
        },
      },
      webgl2: null,
    },
    webgpu: {
      available: true,
      preferred_canvas_format: "bgra8unorm",
      high_performance: {
        is_fallback_adapter: false,
        features: ["texture-compression-bc"],
        info: { vendor: "intel", architecture: "gen-12lp" },
        limits: { maxBufferSize: "2147483648", minUniformBufferOffsetAlignment: 256 },
      },
    },
    ...overrides,
  };
}

test("normalizes a ClearCote profile with both graphics APIs", () => {
  const profile = normalizeGpuProfile(createProfile());

  expect(profile).toMatchObject({
    schema: "clearcote-profile",
    schemaVersion: GPU_PROFILE_SCHEMA_VERSION,
    source: GPU_PROFILE_SOURCE_URL,
    id: "intel-test",
    gpuVendor: "Intel",
    webgl: {
      webgl1: {
        parameters: { MAX_TEXTURE_SIZE: 16384 },
        extensions: ["WEBGL_debug_renderer_info"],
      },
    },
    webgpu: {
      available: true,
      preferredCanvasFormat: "bgra8unorm",
      isFallbackAdapter: false,
      features: ["texture-compression-bc"],
      limits: {
        maxBufferSize: 2147483648,
        minUniformBufferOffsetAlignment: 256,
      },
    },
  });
  expect(getGpuProfileSummary(profile)).toEqual({
    id: "intel-test",
    vendor: "Intel",
    family: "Iris",
    webglSurfaces: 1,
    webgpuAvailable: true,
    webgpuFeatures: 1,
    webgpuLimits: 2,
  });
});

test("accepts a compact profile wrapper and rejects incomplete or oversized data", () => {
  const compact = normalizeGpuProfile({ profile: createProfile() });
  expect(compact.id).toBe("intel-test");
  expect(normalizeGpuProfile(null)).toBeNull();
  expect(normalizeGpuProfile({ webgl: {}, webgpu: {} })).toBeNull();
  expect(normalizeGpuProfile({
    ...createProfile(),
    webgpu: { available: false },
  })).toBeNull();
  expect(
    normalizeGpuProfile({
      ...createProfile(),
      padding: "x".repeat(512 * 1024),
    }),
  ).toBeNull();
});

test("supports the collector's direct WebGPU shape and safe text normalization", () => {
  const profile = normalizeGpuProfile({
    ...createProfile(),
    meta: {},
    id: " direct-id ",
    gpuVendor: " Vendor ",
    webgl: {
      webgl1: {
        debug: { VERSION: "WebGL 1.0", UNKNOWN: 1 / 0 },
      },
    },
    webgpu: {
      available: false,
      preferredCanvasFormat: " rgba8unorm ",
      isFallbackAdapter: true,
      features: ["feature"],
      info: { vendor: "vendor", architecture: "architecture" },
      limits: { maxBufferSize: 10 },
    },
  });

  expect(profile).toMatchObject({
    id: "direct-id",
    gpuVendor: "Vendor",
    webgl: { webgl1: { debug: { VERSION: "WebGL 1.0" } } },
    webgpu: {
      available: false,
      preferredCanvasFormat: "rgba8unorm",
      isFallbackAdapter: true,
    },
  });
});

test("accepts an Apify FingerprintGenerator result without inventing WebGPU data", () => {
  const profile = normalizeGpuProfile({
    source: APIFY_FINGERPRINT_SUITE_SOURCE_URL,
    meta: {
      id: "apify-macos-chrome",
      browser: "chrome",
      operating_system: "macos",
    },
    fingerprint: {
      navigator: { userAgent: "Mozilla/5.0" },
      screen: { width: 2560, height: 1440 },
      videoCard: {
        vendor: "Google Inc. (Apple)",
        renderer: "ANGLE (Apple, Apple M2, OpenGL 4.1)",
      },
    },
  });

  expect(profile).toMatchObject({
    schema: "fingerprint-suite-profile",
    source: APIFY_FINGERPRINT_SUITE_SOURCE_URL,
    id: "apify-macos-chrome",
    webgl: {
      webgl1: {
        debug: {
          UNMASKED_VENDOR_WEBGL: "Google Inc. (Apple)",
          UNMASKED_RENDERER_WEBGL: "ANGLE (Apple, Apple M2, OpenGL 4.1)",
        },
      },
    },
    webgpu: null,
    navigator: { userAgent: "Mozilla/5.0" },
    screen: { width: 2560, height: 1440 },
  });
  expect(getGpuProfileSummary(profile)).toMatchObject({
    id: "apify-macos-chrome",
    webgpuAvailable: null,
    webgpuFeatures: 0,
    webgpuLimits: 0,
  });
});

test("normalizes the bundled profile index without allowing path traversal", () => {
  expect(GPU_PROFILE_BUNDLE_PATH).toBe("profiles/clearcote");
  expect(getGpuProfileAssetPath("vinyzu-04201")).toBe(
    "profiles/clearcote/vinyzu-04201.json",
  );
  expect(getGpuProfileAssetPath("../secret")).toBeNull();
  expect(normalizeGpuProfileIndex(null)).toEqual([]);
  expect(
    normalizeGpuProfileIndex({
      profiles: [
        {
          id: "gpu-1",
          gpu_vendor: " Intel ",
          gpu_family: "Iris",
          renderer: "Renderer",
          screen: "1920x1080",
          hardware_concurrency: "8",
          device_memory: 8,
        },
        { id: "../bad" },
      ],
    }),
  ).toEqual([
    {
      id: "gpu-1",
      gpuVendor: "Intel",
      gpuFamily: "Iris",
      renderer: "Renderer",
      screen: "1920x1080",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      webgpuAvailable: true,
    },
  ]);

  expect(
    normalizeGpuProfileIndex({
      source: APIFY_FINGERPRINT_SUITE_SOURCE_URL,
      profiles: [
        {
          id: "apify-ios-safari",
          bundle_path: APIFY_PROFILE_BUNDLE_PATH,
          webgpu_available: false,
          webgpu_profiled: false,
          selectable: false,
        },
      ],
    }),
  ).toEqual([
    {
      id: "apify-ios-safari",
      gpuVendor: "",
      gpuFamily: "",
      renderer: "",
      screen: "",
      hardwareConcurrency: null,
      deviceMemory: null,
      webgpuAvailable: false,
      source: APIFY_FINGERPRINT_SUITE_SOURCE_URL,
      bundlePath: APIFY_PROFILE_BUNDLE_PATH,
      selectable: false,
      webgpuProfiled: false,
    },
  ]);
});
