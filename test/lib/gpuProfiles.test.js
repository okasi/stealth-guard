import { expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  GPU_PROFILE_SCHEMA_VERSION,
  GPU_PROFILE_SOURCE_URL,
  APIFY_FINGERPRINT_SUITE_SOURCE_URL,
  GPU_PROFILE_BUNDLE_PATH,
  getGpuProfileAssetPath,
  getGpuProfileSummary,
  loadBundledGpuProfile,
  loadBundledGpuProfileIndex,
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
  const cyclic = createProfile();
  cyclic.self = cyclic;
  expect(normalizeGpuProfile(cyclic)).toBeNull();
});

test("normalizes bounded primitive, surface, adapter, and fallback variants", () => {
  const profile = normalizeGpuProfile({
    schema: "fingerprint-suite-profile",
    id: "fallbacks",
    webgl: {
      webgl1: {
        parameters: {
          BOOLEAN: true,
          STRING: "x".repeat(300),
          ARRAY: [1, false, Number.NaN],
          DEEP: { one: { two: { three: 1 }, invalid: Number.NaN } },
          BAD: Number.NaN,
          HUGE_ARRAY: Array(65).fill(1),
        },
        context_attributes: { alpha: true },
      },
    },
    webgpu: {
      lowPerformance: {
        isFallbackAdapter: false,
        features: [" feature ", 7, ""],
        info: { device: "device", description: "description" },
        limits: { valid: "4", negative: -1, invalid: "no" },
      },
      preferredCanvasFormat: "rgba8unorm",
    },
  });

  expect(profile).toMatchObject({
    source: APIFY_FINGERPRINT_SUITE_SOURCE_URL,
    webgl: {
      webgl1: {
        parameters: {
          BOOLEAN: true,
          STRING: "x".repeat(256),
          ARRAY: [1, false],
          DEEP: { one: { two: {} } },
        },
        contextAttributes: { alpha: true },
      },
    },
    webgpu: {
      features: ["feature"],
      limits: { valid: 4 },
      preferredCanvasFormat: "rgba8unorm",
    },
  });
  expect(profile.webgl.webgl1.parameters.HUGE_ARRAY).toBeUndefined();
  expect(profile.webgl.webgl1.parameters.BAD).toBeUndefined();

  expect(
    normalizeGpuProfile({
      source: APIFY_FINGERPRINT_SUITE_SOURCE_URL,
      fingerprint: { videoCard: { vendor: "Vendor" } },
    }).webgl.webgl1.debug,
  ).toMatchObject({ UNMASKED_VENDOR_WEBGL: "Vendor" });
  expect(
    normalizeGpuProfile({
      source: APIFY_FINGERPRINT_SUITE_SOURCE_URL,
      fingerprint: { videoCard: { renderer: "Renderer" } },
    }).webgl.webgl1.debug,
  ).toMatchObject({ UNMASKED_RENDERER_WEBGL: "Renderer" });
  expect(
    normalizeGpuProfile({
      source: APIFY_FINGERPRINT_SUITE_SOURCE_URL,
      fingerprint: { videoCard: {} },
    }),
  ).toBeNull();
  expect(
    normalizeGpuProfile({
      source: APIFY_FINGERPRINT_SUITE_SOURCE_URL,
      webgl: { webgl2: { extensions: ["extension"] } },
    }).webgl,
  ).toMatchObject({ webgl1: null, webgl2: { extensions: ["extension"] } });
  expect(
    normalizeGpuProfile({
      source: APIFY_FINGERPRINT_SUITE_SOURCE_URL,
      webgl: { webgl1: { context_attributes: { alpha: true } } },
    }),
  ).toBeNull();
});

test("summarizes missing identifiers and WebGPU-only vendor metadata", () => {
  expect(getGpuProfileSummary(null)).toBeNull();
  expect(
    getGpuProfileSummary({
      source: APIFY_FINGERPRINT_SUITE_SOURCE_URL,
      fingerprint: { videoCard: { vendor: "WebGL Vendor" } },
      webgpu: { adapter: { info: { vendor: "WebGPU Vendor" } } },
    }),
  ).toMatchObject({
    id: "Imported profile",
    vendor: "WebGPU Vendor",
    webgpuAvailable: true,
  });
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
    },
  ]);

  expect(
    normalizeGpuProfileIndex({
      source: APIFY_FINGERPRINT_SUITE_SOURCE_URL,
      profiles: [
        {
          id: "apify-ios-safari",
          bundle_path: "../ignored",
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
    },
  ]);
});

test("loads the bundled profile index and individual validated assets", async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.chrome = {
      runtime: { getURL: vi.fn((path) => `extension://${path}`) },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        profiles: [
          { id: "webgpu", webgpu_available: true },
          { id: "webgl-only", webgpu_available: false },
        ],
      }),
    });

    await expect(loadBundledGpuProfileIndex()).resolves.toEqual([
      expect.objectContaining({ id: "webgpu" }),
      expect.objectContaining({ id: "webgl-only" }),
    ]);
    expect(globalThis.chrome.runtime.getURL).toHaveBeenCalledWith(
      "profiles/clearcote/index.json",
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => createProfile(),
    });
    await expect(loadBundledGpuProfile("intel-test")).resolves.toMatchObject({
      id: "intel-test",
      schema: "clearcote-profile",
    });
    expect(globalThis.chrome.runtime.getURL).toHaveBeenLastCalledWith(
      "profiles/clearcote/intel-test.json",
    );
    await expect(loadBundledGpuProfile("../secret")).rejects.toThrow(
      "Invalid bundled GPU profile",
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => createProfile({ meta: { id: "wrong" } }),
    });
    await expect(loadBundledGpuProfile("intel-test")).rejects.toThrow(
      "Bundled GPU profile is invalid",
    );

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
    await expect(loadBundledGpuProfileIndex()).resolves.toEqual([]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("malformed index");
      },
    });
    await expect(loadBundledGpuProfileIndex()).resolves.toEqual([]);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(loadBundledGpuProfileIndex()).resolves.toEqual([]);
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  }
});
