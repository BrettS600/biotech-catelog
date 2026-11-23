Collector: its git clones follow the account to driftcodedev at every start

The droplet's clones were made under BrettS600 (GitHub forwards that name only until somebody takes it). At start the
collector points its code repo, the live and the archive checkouts at driftcodedev; scans.py does the same for its
card-data checkout and the scan-results clone. The scrap start signal (a POST) had failed since the rename, as urllib
does not follow GitHub's 307 - g52's new address fixed it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
