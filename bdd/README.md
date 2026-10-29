# Behavioral specifications

`bdd/spec/` is the target specification. It has one feature file per agreed
wiki story. These files describe requirements; they are not executable tests.

`apps/<name>/features/` contains the as-built, executable Playwright BDD suites.
Those scenarios describe what each app currently demonstrates.

## Scenario IDs

Each target scenario has a tag such as `@F2-3`. Assign an ID once and never
reuse it. A new scenario takes the next number in its file. If a scenario is
deleted, leave its number unused.

An as-built scenario claims coverage only when it fully demonstrates every
outcome of the target scenario. Add the target ID to that scenario's tags.
Partial coverage gets no ID tag.

`bdd/stories.json` maps the requirements backlog to wiki stories, owning apps,
and target spec files. `bdd/coverage-notes.md` records the coverage judgment for
every target scenario and names the as-built evidence.
