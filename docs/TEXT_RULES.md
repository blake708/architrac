# ArchiTrac Text Rules

Version 1.0 · Nov 13, 2026

## 1. Scope

These rules apply to all text in ArchiTrac: labels, buttons, messages, help text, notifications, emails, reports, and all AI-generated text.

The base standard is **ASD-STE100 Issue 9** (Simplified Technical English, Jan 2025). Rules marked **AT** are ArchiTrac additions.

**Main rule:** Use the fewest words that give the full meaning. If a word adds no information, delete it.

## 2. Sentence rules (STE)

| # | Rule | Do | Do not |
|---|---|---|---|
| 2.1 | Instructions: max 20 words. | Select a phase. | — |
| 2.2 | Descriptions: max 25 words. | — | — |
| 2.3 | One instruction or one topic per sentence. | Select a client. Then select a project. | Select a client and then pick the project you want to bill. |
| 2.4 | Paragraphs: max 6 sentences (STE). In the UI, max 3 (AT). | — | — |
| 2.5 | Use active voice. Use passive only when the agent is unknown. | The team leader approves timesheets. | Timesheets are approved by the team leader. |
| 2.6 | Use the imperative for instructions. | Enter the fee. | You should enter the fee. |
| 2.7 | Use simple tenses only: present, past, future. | ArchiTrac saved the file. | The file has been saved. |
| 2.8 | Noun clusters: max 3 words. | Phase fee report | Project phase fee allocation summary report |
| 2.9 | Put the condition first. | If the invoice is paid, you cannot edit it. | You cannot edit it if the invoice has been paid. |
| 2.10 | Use a vertical list for 3+ items or steps. | — | — |
| 2.11 | Start a warning with a command. | Do not delete this phase. Timesheets use it. | Please be aware that deleting this phase could affect timesheets. |
| 2.12 | Keep articles (a, an, the) in sentences. | Add a client. | Add client to project before billing. |
| 2.13 | Use **must** for a requirement and **can** for an option. Do not use should, may, or might (AT). | You must add a client email. | You may want to consider adding an email. |

**Exception (AT):** Labels, buttons, titles, and status messages can be fragments. See section 6.

## 3. Word rules

Use one word for one meaning. Use the simple word.

| Do not use | Use |
|---|---|
| utilize, leverage | use |
| in order to | to |
| prior to | before |
| subsequent to, following | after |
| at this time, currently | now (or delete) |
| due to the fact that | because |
| is able to | can |
| in the event that | if |
| a number of | some, or the number |
| approximately | about |
| additional | more |
| commence, initiate | start |
| terminate | stop, end |
| modify | change |
| obtain | get |
| assist, facilitate | help |
| regarding | about |
| fill out, fill in | complete |
| look up | find |
| please note that, successfully, simply, just, easily, very, really, quite | (delete) |

## 4. ArchiTrac terms

Use the same term for the same thing every time. Starter list; edit to match the app.

| Term | Meaning | Do not use |
|---|---|---|
| Project | A contracted scope of work | job, engagement |
| Client | The entity that pays | customer, owner (unless the contract role) |
| Phase | A fee/schedule division (SD, DD, CD, CA) | stage, milestone |
| Timesheet | One person's hours for one week | time card |
| Create | Make a new item. Exception: buttons that open a new-item form can say "New" (New project, New invoice; Blake, 2026-11-13). | add (for new items) |
| Add | Put an existing item into a list or project | create (for existing items) |
| Delete | Remove permanently | remove, erase |
| Remove | Take off a list. The item stays. | delete |
| Archive | Hide but keep | close, deactivate |
| Save | Keep a draft | — |
| Submit | Send for approval | send, save |
| Approve / Return | Approval decisions. A returned timesheet goes back to its person to fix (Blake, 2026-11-13). | accept, decline, deny, reject |
| Module | An add-on area (Build, Marketing, Accounting) | feature, plugin, app |

Industry terms (RFI, submittal, CA, SD, DD, CD, AIA B101) are technical names. Use them without explanation.

## 5. Anti-AI-slop rules (AT)

These apply to all AI-generated text and all text a person writes.

1. **No openers.** Do not write "Great question," "Certainly," "Sure," "I'd be happy to," "Here's a," or "Let's dive in." Start with the answer.
2. **No closers.** Do not write "Let me know if," "I hope this helps," "Feel free to," or "In summary" plus a restatement.
3. **No slop words:** delve, seamless, robust, streamline, elevate, empower, unlock, harness, cutting-edge, game-changer, comprehensive, holistic, landscape, realm, journey, navigate (figurative), crucial, pivotal, vital, key (adjective), boast, showcase, foster, embark, effortless, intuitive, meticulous, tailored.
4. **No contrast framing.** Do not write "It's not X, it's Y" or "Not only X, but also Y."
5. **No padding in threes.** Use one adjective, not three.
6. **No em dashes.** Use a period or a comma. Do not use semicolons in the UI.
7. **No exclamation marks. No emoji.**
8. **No hedges:** "It's important to note," "It's worth mentioning," "generally," "typically," "potentially."
9. **Do not restate** the question, the heading, or the field label.
10. **No cheer or apology:** "Great job," "Oops," "Uh oh," "Sorry."
11. **No invented data.** If the data is not available, write "No data." State the source of each number in AI summaries.
12. **No marketing tone** inside the app.
13. **The app does not say "I" or "we."** Write "Saving…" not "We're saving your changes."
14. **Numbers:** Use digits and units: 3 days, $12,500, 85%. Dates: Nov 13, 2026.
15. **Formatting:** No headings in answers under 100 words. Bold only the one item the reader must see.

## 6. Patterns by UI element

Use sentence case for all UI text.

| Element | Rule | Do | Do not |
|---|---|---|---|
| Menu / page title | Noun, 1–2 words | Projects | My Projects Dashboard |
| Button | Verb + noun, 1–3 words | Approve timesheet | Click here to approve |
| Field label | Noun. No colon. No "Enter." | Project number | Please enter the project number: |
| Placeholder | Example value only | 2026-014 | Enter project number here |
| Help text | 1 sentence, max 15 words | Hours over 40 go to the principal for approval. | This field allows you to... |
| Tooltip | Max 10 words | Includes overhead | This value represents the total... |
| Success message | Object + past-tense verb, 2–4 words | Invoice sent. | Success! Your invoice has been sent successfully! |
| Error message | What failed + how to fix. Max 2 sentences. | Invoice not sent. Add a client email. | Error: Something went wrong. |
| Confirm dialog title | Verb + object as a question | Delete Phase 2? | Are you sure? |
| Confirm dialog body | Result in 1 sentence + "You cannot undo this" if true | This also deletes 14 time entries. You cannot undo this. | Deleting may have consequences. |
| Confirm dialog buttons | Repeat the verb | Delete phase / Cancel | Yes / No, OK |
| Empty state | What goes here + 1 action | No invoices. Create an invoice to bill this project. | Looks like there's nothing here yet! |
| Loading | Verb-ing + object + … | Loading projects… | Please wait while we load your data |
| Notification subject | Event: object | Timesheet rejected: Week of Nov 9 | Update on your timesheet |
| AI summary | Result first. Max 5 bullets. | 3 invoices are past 60 days ($41,200). | Here's a comprehensive overview of your AR landscape. |

## 7. Before and after

| Before | After |
|---|---|
| Your timesheet has been successfully submitted and will now be reviewed by your team leader. | Timesheet submitted. Your team leader reviews it next. |
| Oops! It looks like something went wrong while trying to save your project. Please try again. | Project not saved. Try again. |
| In order to create an invoice, you will first need to make sure that a client has been assigned. | Add a client. Then create the invoice. |
| Are you sure you want to proceed? This action cannot be undone. | Archive Lowcountry Ortho? You can restore it from Settings. |
| This project is not just on budget — it's thriving, with robust margins across all phases. | Project margin: 22%. All phases are on budget. |

## 8. AI prompt block

Paste this into every system prompt that writes text for ArchiTrac (Claude API calls, n8n workflows, Bubble API connector).

```
Write in ASD-STE100 Simplified Technical English.
- Instructions: max 20 words per sentence. Descriptions: max 25.
- One instruction or topic per sentence. Max 3 sentences per paragraph.
- Active voice. Imperative for instructions. Simple present, past, or future tense.
- Use the simplest word. One word = one meaning. Use ArchiTrac terms: Project, Client, Phase, Timesheet, Create, Add, Delete, Remove, Archive, Submit, Approve, Reject.
- Use "must" for requirements and "can" for options. Never use should, may, might.
- Start with the answer. No greeting, no closing offer, no restating the question.
- Never use: delve, seamless, robust, leverage, streamline, elevate, empower, unlock, comprehensive, holistic, landscape, crucial, pivotal, key (adjective), ensure, utilize.
- No em dashes, semicolons, exclamation marks, or emoji.
- No "It's not X, it's Y." No lists of three adjectives. No hedges.
- Numbers as digits with units. State the source of each number. If data is missing, write "No data."
- Never say "I" or "we."
- Use the fewest words that give the full meaning.
```

## 9. Review checklist

Each check is countable. Fix every "yes."

- [ ] Is any instruction over 20 words, or any description over 25?
- [ ] Does any sentence have 2 instructions or 2 topics?
- [ ] Is any UI paragraph over 3 sentences?
- [ ] Is any verb passive with a known agent?
- [ ] Is there a noun cluster over 3 words?
- [ ] Is there a word from the "Do not use" list or the slop list?
- [ ] Is there an em dash, exclamation mark, or emoji?
- [ ] Does the text use 2 names for the same thing?
- [ ] Can you delete a word and keep the meaning?

## Sources

- [ASD-STE100 official site (free copy of Issue 9)](https://www.asd-ste100.org)
- [Term checker rules for ASD-STE100 Issue 9](https://simplified-english.co.uk/rules-ste9.html)
- [Simplified Technical English overview](https://www.wikiwand.com/en/articles/ASD-STE100)
