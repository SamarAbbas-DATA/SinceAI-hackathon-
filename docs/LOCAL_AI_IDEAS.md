# Small local AI: where it could help (ideas, not implemented)

> Superseded: the tool now has "Fix with AI" (OpenRouter, see README). These local-model ideas are kept for reference only.

Every pass, amber or red verdict in this tool comes from deterministic code and `rules.json`, and it stays that way. A local AI would only add a few convenience features around the edges. It never decides whether something complies, never computes a physical value and never changes a threshold.

## Ground rules

- **No verdicts.** The AI never sets or changes a flag status, a number in a result, or a value in `rules.json`.
- **Labelled.** Every AI output is marked "AI suggestion" and can be ignored. The PDF report keeps AI text out of the flag list.
- **Validated.** Output is a short text or a small JSON object that the code checks before using. For example, a suggested room type must be one of `SPACE_TYPES`; anything else is dropped.
- **Grounded.** The AI gets only the text it needs (one finding with its quoted clause, or one room name). It is told not to cite clauses that are not in its input.
- **Optional and offline.** If no model is running, the buttons simply do not appear. Nothing leaves the machine.

## Which model

| Use | Model | Size (4-bit) | How it runs |
|---|---|---|---|
| Short explanations, room-name hints, summaries | Qwen2.5-1.5B-Instruct (alternative: Phi-3.5-mini 3.8B for better wording) | about 1 GB (Phi: about 2.3 GB) | Ollama on `localhost:11434`, called from the browser with `fetch`; or in the browser with WebLLM (WebGPU) |
| Searching the regulation PDFs | all-MiniLM-L6-v2 sentence embeddings | about 23 MB | in the browser with transformers.js; the PDF text in `docs/` is split into paragraphs and embedded once |

Both are free and run on an ordinary laptop. The tool has no backend, so Ollama is the simplest choice. WebLLM avoids any install but needs a WebGPU browser and a first download.

## The checks and helpers the AI would do

1. **Explain a flag in plain words.**
   - **Where:** an "Explain" link under a finding in the Issues panel.
   - **Input:** the finding's `message`, `detail`, `fix` and the quoted clause from `rules.json` refs.
   - **Output:** 2 to 3 sentences for a non-specialist, optionally in Finnish.
   - **Check:** at most 400 characters, and it must not contain numbers that are not in the input (a simple regex comparison).

2. **Room name and type hint.**
   - **When:** a space is named, for example "Laundry 3", "Crew mess" or "Pantry", and its type is "other".
   - **Ask:** "Which of these types fits this name: cabin, corridor, public, galley, engine_room, store, other?"
   - **Use:** shown as a chip, "Looks like a galley. Change type?", which the user confirms.
   - **Why it matters:** the fire rating table and the cable routing check depend on the type. Today laundries are only recognised by the word "laundr" in the name.

3. **Find the paragraph in the regulations.**
   - **Where:** a search box on the Sources tab ("corridor width at stairs", "handrails").
   - **How:** embeddings rank the paragraphs of the PDFs in `docs/` and the result opens the PDF at that page.
   - **Retrieval only:** no generated text, so nothing can be invented.

4. **Name and label tidy-up after an import.**
   - **What:** for an imported design with names like "CAB_03_P" or "rm12", the AI suggests readable names ("D3 cabin port 03") in one batch the user can accept or reject.
   - **Effect:** purely cosmetic, so a wrong suggestion has no consequence.

5. **One-paragraph summary for the report cover.**
   - **Input:** the list of red and amber rule titles and the counts.
   - **Output:** one paragraph, clearly marked as AI-written, above the deterministic flag list.

6. **Spot inconsistent persons numbers (hint only).**
   - **What:** compares room names with the persons entered ("Single cabin" with 4 persons, "Store" with 6 persons) and lists the odd ones as "worth a look".
   - **Hard limits stay deterministic:** the DESIGN-SANITY rule still owns the actual limits (3.5 persons/m2, no persons in tanks). This only catches name and number mismatches the rules cannot see.

## What the AI should not be used for

- **Physics and verdicts:** stability, flooding, evacuation times, fire zone sizes, pipe clearances or any pass/fail decision.
- **Rules and values:** writing or changing `rules.json`, or filling in values that THINGS_TO_ASK.txt says must come from Meyer Turku.
- **Unreviewed edits:** placing rooms, doors or pipes without the user confirming.

## How it would fit the code

- `src/ai/` (new, optional): `client.ts` (Ollama or WebLLM call with a 5 s timeout and a small cache), `prompts.ts` (one short template per helper), `validate.ts` (JSON and range checks).
- **UI:** an "Explain" link in `FindingRow`, a hint chip in the space inspector, and a search box on the Sources tab. Each appears only when a model answers a health check at startup.
- **Tests:** the deterministic tests stay unchanged. The AI helpers get tests with a fake client that returns fixed text, so `npm test` never needs a model.
- **Effort:** helpers 1 and 2 about a day each; helper 3 (embedding search) about two days, including splitting the PDFs into paragraphs.
