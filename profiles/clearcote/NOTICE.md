# Bundled ClearCote profiles

This directory contains 54 runtime-distinct WebGL/WebGPU profiles from
[clearcote-profiles](https://github.com/clearcotelabs/clearcote-profiles),
derived from the [Vinyzu chrome-fingerprints](https://github.com/Vinyzu/chrome-fingerprints)
dataset.

Captures are normalized to the WebGL/WebGPU fields consumed by the extension.
Unused capture metadata and other fingerprint surfaces are omitted. All 54
normalized profiles retain the same runtime values as their source captures;
chooser metadata remains in `index.json`.

The bundled profile data is distributed under GNU GPL-3.0. The corresponding
license text is included in `LICENSE`. The profiles are device data only; they
must not be combined with an incompatible browser or GPU identity.
