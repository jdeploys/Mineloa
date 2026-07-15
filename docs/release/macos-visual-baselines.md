# macOS processing-settings visual baselines

Release CI never creates or updates visual expectations. It only compares the
current UI against reviewed PNGs committed under
`tests/visual/snapshots/darwin/`.

To intentionally update those pixels:

1. Manually run the `record-macos-visual-baselines` workflow for the exact commit.
2. Download its `macos-processing-settings-baselines-<commit>` artifact.
3. Inspect every PNG at original resolution on a macOS-calibrated display.
4. Copy only the reviewed `processing-*.png` files into
   `tests/visual/snapshots/darwin/`, run the comparison again, and commit them in
   a dedicated screenshot commit.
5. Run release CI. It will fail if a reviewed Darwin baseline is absent or the
   rendered pixels differ.

Artifacts are evidence for review, not accepted baselines by themselves.
