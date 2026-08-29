#!/usr/bin/env node

const PRESETS = Object.freeze({
  "windows-edge": { browser: "edge", operatingSystem: "windows", device: "desktop" },
  "macos-chrome": { browser: "chrome", operatingSystem: "macos", device: "desktop" },
  "macos-safari": { browser: "safari", operatingSystem: "macos", device: "desktop" },
  "ios-safari": { browser: "safari", operatingSystem: "ios", device: "mobile" },
  "android-chrome": { browser: "chrome", operatingSystem: "android", device: "mobile" },
});

const presetName = process.argv[2] || "windows-edge";
const preset = PRESETS[presetName];
if (!preset) {
  console.error(`Unknown preset: ${presetName}`);
  console.error(`Available presets: ${Object.keys(PRESETS).join(", ")}`);
  process.exitCode = 1;
} else {
  let fingerprintGeneratorModule;
  try {
    fingerprintGeneratorModule = await import(
      process.env.FINGERPRINT_GENERATOR_PACKAGE || "fingerprint-generator"
    );
  } catch (error) {
    console.error(
      "Install Apify's fingerprint-generator package before running this helper.",
    );
    console.error(error.message);
    process.exitCode = 1;
  }

  if (fingerprintGeneratorModule) {
    const FingerprintGenerator =
      fingerprintGeneratorModule.FingerprintGenerator;
    if (typeof FingerprintGenerator !== "function") {
      console.error("The installed package does not export FingerprintGenerator.");
      process.exitCode = 1;
    } else {
      const generator = new FingerprintGenerator();
      const generated = generator.getFingerprint({
        browsers: [preset.browser],
        operatingSystems: [preset.operatingSystem],
        devices: [preset.device],
      });
      const output = {
        source: "https://github.com/apify/fingerprint-suite",
        meta: {
          id: `apify-${presetName}`,
          browser: preset.browser,
          operating_system: preset.operatingSystem,
          device_type: preset.device,
        },
        ...generated,
      };
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    }
  }
}
