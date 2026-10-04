# Architecture image prompts

Both diagrams were generated with the built-in ImageGen tool in an Excalidraw-inspired style. Each is a complete generated raster image, including its labels and arrows.

## Swarm QA architecture

Output: `swarm-qa-architecture.png`

```text
Use case: infographic-diagram
Asset type: architecture diagram embedded in the Swarm QA GitHub README.
Primary request: Explain the intended architecture of Swarm QA: a real swarm of AI players automatically explores games to find where the experience is not fun, then validates and reports the issues.
Style: polished Excalidraw-style technical sketch, slightly irregular dark charcoal outlines, clean hand-lettered sans-serif text, ivory white background, restrained pale lime, pale blue and peach fills. Professional and highly legible. Landscape 16:9, generous margins, readable at GitHub README width.
Layout: clear left-to-right top row, then right-to-left bottom row forming one large understandable loop. Use arrowheads and spacious connectors. No crossing arrows.
Top left box: "ORCHESTRATOR" with smaller "Goals · coverage · budgets". Arrow to a large center group labelled "PARALLEL PLAYER AGENTS". Inside, four small agents above four tiny distinct game windows, each connected to its own game window. Agent labels: "Beginner", "Experienced", "Explorer", "Adversarial". Group footer: "Isolated game sessions". Arrow from this group to top right box "SHARED EVIDENCE" with "Screenshots · actions · outcomes".
Top-right box flows down to bottom-right box "CRITICS + PATTERN MINING", smaller "Frustration · exploits · dead ends".
Then arrow left to bottom center box "REPRODUCE + CHALLENGE", smaller "Fresh runs · counterfactual tests". Then arrow left to bottom-left box "ACTIONABLE FINDINGS", smaller "Player impact · replay · evidence".
A roomy return arrow from ACTIONABLE FINDINGS along the outside left edge back to ORCHESTRATOR is labelled "Fix → regression runs".
Large title above all boxes: "Swarm QA"
Subtitle under title: "Find what is not fun. Show why."
Constraints: all quoted text spelled exactly; text sharp, high contrast and generous size; no labels beyond those specified; no paragraphs; no code; no photorealism; no simulated metrics or claims of measured performance. Use subtle controller, magnifying-glass and evidence-page doodles if helpful, but prioritize explanatory structure. All art and text must be generated as one complete image.
```

## JEV + vision LLM

Output: `jev-vision-loop.png`

```text
Use case: infographic-diagram
Asset type: architecture diagram embedded in the Swarm QA GitHub README.
Primary request: Explain a two-speed gameplay agent combining JEV for routine structured decisions and an LLM with vision for visual understanding, planning and recovery.
Style: polished Excalidraw-style technical sketch, slightly irregular charcoal outlines, clean hand-lettered sans-serif text, ivory white background, restrained pale lime, pale blue and peach fills. Professional and highly legible. Landscape 16:9 with generous margins, readable at GitHub README width.
Large title: "JEV + vision LLM"
Subtitle: "Fast decisions. Visual understanding when it matters."
Layout: a clear closed feedback loop, with five roomy stages and an explicit escalation branch.
Left: box "GAME" with a tiny drawn game screenshot (platform, ball and player) and sublabel "Native inputs + outcomes".
Next, center-left box "OBSERVE" with sublabel "Screenshot + game state".
From OBSERVE one upper arrow labelled "Compact features" goes to a lime box "JEV" with sublabel "Choose the next action".
From OBSERVE one lower arrow labelled "Visual context" goes to a pale blue box "VISION LLM" with sublabel "Understand · plan · recover".
From JEV, an arrow down to VISION LLM is labelled "Uncertain or stuck".
From VISION LLM, an arrow back up to JEV on the right of those boxes is labelled "Updated plan".
From JEV, an arrow right labelled "Confident action" enters a peach box "VALIDATE + EXECUTE", sublabel "Allowed inputs · bounded steps".
From VISION LLM, a distinct rightward arrow labelled "Visual action" enters VALIDATE + EXECUTE from below.
A return arrow along the bottom from VALIDATE + EXECUTE to GAME is labelled "Apply input → observe the result".
A compact note across the bottom inside a hand-drawn bracket: "Each decision records: source · latency · reason · outcome".
Constraints: avoid crossing arrows, every arrow clearly directed, all quoted text spelled exactly, large crisp text, no dense paragraphs, no code, no speed claims or numeric performance assertions, no statement that JEV consumes screenshots. All art and text must be generated as one complete image.
```
