# Apify Fingerprint Suite bridge

This directory records the supported Apify generator presets. Apify's
`fingerprint-generator` is a Node.js generator rather than a static WebGPU
profile catalog, so the generator itself is not executed inside the MV2
extension and no generated output is represented as a real-device capture.

Generate an importable profile with:

```sh
npm install --no-save fingerprint-generator
node tools/generate-apify-profile.mjs windows-edge > apify-profile.json
```

Supported presets: `windows-edge`, `macos-chrome`, `macos-safari`,
`ios-safari`, and `android-chrome`. Import the generated JSON from Advanced
Settings. The bridge maps Apify's `fingerprint.videoCard` into the extension's
WebGL identity surface and does not apply a sourced WebGPU adapter profile
unless the JSON also contains an explicit WebGPU section. The extension's
generic WebGPU protection can still apply; it simply does not use Apify data as
an adapter profile.

Apify's source code is Apache-2.0 licensed. See the upstream repository for
the generator model and current browser/OS support:

<https://github.com/apify/fingerprint-suite>
