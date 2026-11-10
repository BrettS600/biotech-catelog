CL Cert reader: PNG and WebP pictures too

The first run (2026-11-10 21:55 UTC) failed on 28 of its first 200 pictures: one in eight of Card Ladder's own copies
is PNG or WebP, which the browser trial decoded but jpeg-js does not. cl_certs.js decodes those with sharp (0.33.5;
cl_certs.yml installs it beside jpeg-js), and the "not a JPEG" rows the first run left are read again at once and count
as no failed try (cl_certs.js, graded_site.load_pic_certs). The 60 test pictures as PNG / lossy WebP read as the JPEGs
on 59 (one WebP lost a weak reading). CLAUDE.md: the above.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
