Collector: the condition pass runs behind the identity lookups, one look per 90 s, 400 a day

At the tail of the optional work the token bucket never had a call left for it: 0 of its 400 looks in its first hours (live log 17:43). Now it takes one full look every 90 s right after the identity lookups, ahead of the window re-reads, and still at most 400 a day (8% of the API budget).

The hourly "Conditions:" line counted every listing with eBay's facts on file, most of them read before the condition code existed, so it said "13,413 carry none" when it meant "not read for this yet". A listing read with the code now carries ec = "" when eBay states nothing (ebay_sweep.apply_condition), and the line counts only those. The raw "Condition: <id> descriptors ..." line now reaches the hourly log as well (ebay_sweep's log is quiet inside the collector).

CLAUDE.md: the pass's new place, the editor flow for the big files, and the apply-patch route this commit came through.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
