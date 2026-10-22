# Style rules

Applies to anything written for other people to read: tickets, Confluence pages, PR descriptions and review comments, commit messages, specs and reports.

- Australian and British English: initialisation, not initialization.
- Join clauses with commas, colons and full stops. No em dashes in prose: an aside goes in commas or
  parentheses, or becomes its own sentence. A semicolon joins two independent clauses that lean on
  each other, at most one per paragraph. En dashes are for ranges (60–80).
- No emojis unless asked.
- No bold-label paragraph openers or bulleted mini-headings.
- State as fact only what you verified, and hedge only what is genuinely uncertain: an inference, an
  outcome that may or may not happen ("On the off chance", "There's a very high chance"), or a step
  that is optional ("Ideally, attach before and after captures"). Say what an inference rests on: "I
  think X does Y, but not sure it extends to Z". A requirement or known behaviour is stated flatly,
  including a requirement someone else implements: "A validation rule should reject `.` and `/`", not
  "Ideally, a validation rule rejects". Softening a fact reads as not knowing it.
- Don't explain how the team's own systems already work. A spec or ticket for the team starts from
  what changes, and existing behaviour appears only where the change depends on a detail the reader
  would otherwise miss.
- Forward-facing artefacts (specs, tickets, team docs) describe what gets built, not how the team
  got there. Leave out decision history, dates, "revised", "reversed" and "previously assumed",
  comparisons with what the code used to do or nearly did, and definition by negation ("no vendor
  abstraction" only parses for a reader who knows there once was one). A working file that exists
  to track decisions keeps its history.
- Write as a colleague. Use first person for your own work and claims ("I've spot checked the list")
  and "we" for work the team shares ("We can tackle it in four stages"), rather than the impersonal
  passive ("The list has been checked") or a bare list of orders.
- Say what to do and leave out how the tooling arrives at it. Cut "because" clauses that explain
  mechanics ("Its tests are not in the list, because tests are not units"). A reason for a decision is
  different: keep it, since the reader can't rebuild it.
- Voice applies to framing, asks and judgement calls. Technical description stays exact: commands,
  paths, file lists, config, and explanations of how a system works are not softened or paraphrased.

