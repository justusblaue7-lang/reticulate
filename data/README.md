# Your data

Everything you make in Reticulate is saved here, as files you can open, back up and share.
Reticulate writes them as you go: every answer in a dialogue is saved the moment you give it.

```
data/
  decisions/
    2026-11-11-should-i-accept-the-job-offer-7db9e85f/
      decision.md     the decision to read: your decision, the dialogue, biases, the panel
      decision.json   the full record: every question and answer, the analysis, the panel,
                      the model, prompt versions, tokens and cost
  avatars/            your own avatars, one YAML file each
  runs/               research runs from the command line (reticulate simulate | sensitivity)
```

- **Open a decision:** `decision.md` reads well in VS Code (Markdown preview: ⇧⌘V) or any
  text editor. In the app, "Show in folder" opens the folder in Finder.
- **Delete a decision:** delete it in the app, or delete its folder here.
- **Back up:** copy this folder. To move to another computer, copy it into the same place in
  the other project folder.
- **Privacy:** this folder stays on your computer and is not part of the code's version
  history (see `.gitignore`). Only this README is.
