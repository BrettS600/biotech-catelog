card_ladder_cert.csv: every CL cert as a link, rebuilt each picture run

cl_certs.js writes card-data data/cardladder/pic_certs/card_ladder_cert.csv at the end of
every run: every cert read off Card Ladder's pictures so far (each grader + cert once), in
scans.csv's format (Cert ID header, one =HYPERLINK cell a cert), oldest read first so new
certs land at the bottom. cl_certs.yml already commits pic_certs/, so it updates every two
hours with the reads. First build: 98,619 certs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
