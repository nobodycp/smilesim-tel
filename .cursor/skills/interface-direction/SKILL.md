---
name: interface-direction
description: Use before any login, form, layout, or visual change. Checks writing direction and light/dark theme so icons, the password reveal, and language controls move with the language and the screen actually changes theme.
---

# Interface direction

Read `.cursor/rules/direction-theme.mdc` and `DESIGN.md` first.

Before editing a screen:

1. Find how `html` gets `dir` and `.dark`. Do not add a second direction on an inner field.
2. Put an icon and a trailing control in one flex row. The icon is the first child. The reveal or action is the last child.
3. Use tokens that differ between `:root` and `.dark`. If a colour must stay put, say so in `DESIGN.md` and still check the other theme for contrast.

Before finishing, look at the rendered page in Arabic and English, light and dark. The icon and the password reveal must swap sides. The page fill, text, and primary button must change. If they do not, the change is not done.
