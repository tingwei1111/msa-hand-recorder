# Synthetic fixtures

`synthetic-match.js` constructs all rows from fictional templates. It does not
load, anonymize, or replay a recorded match. The same dependency-free generator
runs in Node tests and the local browser demo.

- **350 rows / 17 turns:** export-size regression, adjacent repeated actions,
  repeated command plays, a command without a card identifier, an unknown future
  event format, and explicit game-start/game-end markers.
- **537 rows / 24 turns:** large-history parsing, exactly 102 pass events, five
  generated-token events, two identical command plays on turn 20, and a linked
  pilot on turn 24 whose target must not be classified as another played card.

`Demo North` and `Demo South`, the fixed test UUID and timestamps, the event
sequence, and every `Sample …` card label are fictional. Card-code tokens exercise
identifier parsing; the generated actions are not a claim about card text or
legal gameplay. All returned batches are fresh objects so tests can safely mutate
them.

The small SVG files in `demo/cards/` are hand-authored rectangles and text. They
contain no official card artwork, external image references, or embedded images.
