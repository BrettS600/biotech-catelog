Collector: scans.csv in links.csv's format (Cert ID + HYPERLINK cells) and a check of card-data's key at each start

Brett, 2026-11-09 (with a screenshot of links.csv): "in the scans.csv files, the links should populate in the format
like this csv" - a "Cert ID" header, then one CSV-quoted cell a slab:
  "=HYPERLINK(""https://www.psacard.com/cert/46790116/psa"",""46790116"")"
  "=HYPERLINK(""https://www.cgccards.com/certlookup/6153192005/"",""6153192005"")"

- scan_link: PSA's page ends in /psa as in links.csv; scan_row() writes the cell; scan_keys() reads the slabs already in
  the file (any link spelling), so each slab is written once.
- The header goes in first when the file has none.
- Once a start the collector tries card-data's key even with nothing waiting: it writes the header (a real push) or, when
  the file is already right, a dry-run push; the log says whether the key works. Brett added the key 2026-11-09.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
