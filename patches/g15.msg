Graded view: the Auth columns become PC Cert, a CL Cert column read off Card Ladder's pictures, eleven CL Cert columns prepared

Brett: "all of the auth columns are derived from auth cert. i was thinking we could label all of those columns, to say
PC Cert ... then we add a copy of each column, but have it start with CL Cert ... the cl cert number can be found in
the images"; then "just prepare the columns for now and and only fill out the column for cl cert. we can remove the
illustrator column. do not include verdict coliumn".

- Auth Cert -> PC Cert, Auth Name ... Auth Estimate -> PC Cert Name ... PC Cert Estimate (and the Auth read button,
  Review's side, the Side button, the help). Auth Illustrator is gone.
- CL Cert, after CL Release: the cert number on Card Ladder's picture of the row's grade (the picture Review shows),
  linked to its PSA / CGC cert page, or a word (not read, none, unreadable, two slabs, picture gone). Searchable.
- CL Cert Name, Set, Set/Card No., Rarity/Finish, Release, Language, Grade, Label, Pop, Pop Higher, Estimate after
  PC Cert Estimate: prepared only - "not looked up" where the CL cert is known. No verdict column.
- A saved column layout keeps its order and hidden columns (cfg.inserted v10-v12).
- cl_certs.js reads each PSA / CGC picture once with the Slab Show Scanner's own reader (zxing build and finder) into
  card-data data/cardladder/pic_certs/; graded_site.py puts the reads on the rows. A workflow (cl_certs.yml, added
  separately) runs it every two hours. 200 random pictures: 186 certs (93%), no wrong or double readings.
- CLAUDE.md: the above.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
