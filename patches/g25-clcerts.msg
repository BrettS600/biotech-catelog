CL Cert columns filled from Brett's reads, PC/CL Cert Match, scans fetch by folder

clcerts.py (new, collector's fast tick, once a UTC day from 08:00 UTC): reads
scan-results/cardladder/ only and files each cert page into card-data
data/cardladder/cert_pages/cert_pages_<YYYY-MM>.csv. graded_site.py reads them into the
eleven CL Cert columns and a new PC/CL Cert Match column: the PC Cert's words against the
CL Cert's (same grader: name, set, number, variety, year; PSA vs CGC: name, number, year).
A mismatch is flagged (red), nothing is re-paired. scans.py: scan-results is now a bare,
tree-less clone that fetches only its one folder's listing and new files by id, so the
15-second scans fetch no longer downloads cardladder/'s listing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
