Collector: the condition pass runs behind the identity lookups, one look per 90 s, 400 a day

At the tail of the optional work the token bucket never had a call left for it: 0 of its 400 looks in its first hours (live log 17:43). Now it takes one full look every 90 s right after the identity lookups, ahead of the window re-reads, and still at most 400 a day (8% of the API budget).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
