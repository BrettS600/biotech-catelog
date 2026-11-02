Graded view: the PSA / CGC cert pages Brett opens fill the Auth columns; Auth Pop, Pop Higher back, Auth Estimate new

Brett (2026-11-02): "whenever I manually open a CGC page or a PSA page, the results are automatically stored in the
results CSV on GitHub. And then the columns are automatically filled out ... we would be filling out the auth columns
on the site". His Cert Reader extension reads the cert pages he opens himself and leaves them in card-inbox; card-data's
hourly ingest files them in data/certs/results.csv (one row per cert, PSA and CGC together). graded_site.py reads it
(load_page_certs) and takes a page Brett opened first for a slab's Auth (src "pg"), then PSA's API, then Card Hedge;
graded_terms.auth_side reads CGC's own fields (card name, set, number, variant, language). The page shows Auth Pop and
Auth Pop Higher again (removed 2026-10-29 because Card Hedge cannot give them) and a new Auth Estimate (PSA's estimate on
its cert page), after Auth Label (layout v9 keeps saved column orders). Tested on the 2026-10-30 snapshot with his two
reads: row 1's PSA 10 and CGC 10 slabs fill in; no page errors, equal cell counts in both views.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
