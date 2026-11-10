Slab Show Scanner: the nothing-readable line suggests the Light; publishes the last change again

The site build of the last change (a smeared frame is dropped early) was fine, but its GitHub Pages deploy job timed out
on GitHub's side ("Timeout reached, aborting!", run 203), so the site stayed one version behind. This patch touches
page/, which builds and publishes again.

- After 3 s with nothing read, the line on the picture says "Nothing readable - hold still, or try the Light" while the
  camera has a light that is off (the Light shortens the exposure, the one lever a web page has against smear).
- The test report says g11k. sw.js: a new offline copy (ssc-v9). CLAUDE.md: the failed deploy and how one is retried.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
