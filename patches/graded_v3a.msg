Graded view: file the page's answers, sort words into the dictionary, TCGplayer artists

collector.py: Review answers (type 'gmark') and sorted words (type 'gterm') are kept (v["gmarks"], v["gterms"]) and
published as live/graded_marks.bin. graded_answers.py (new, run by the site workflow) merges them into card-data
ids/marks.csv and applies each new word decision once to dictionary/terms.csv, logged in dictionary/decisions.csv.
tcg_details.py (new) reads the Artist from TCGplayer's product details for the graded view's cards not read yet,
cached in card-data tcgplayer/details.csv; it stops at the first refusal. graded_terms.py / graded_site.py: the
unknown words of each unidentified phrase, the dictionary's names for the page's "same as", the PC illustrator from
TCGplayer, Review answers as numbers. CLAUDE.md notes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VsjbDzVu16FJqCintg9h7Q
