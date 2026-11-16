// Load the plugins here. This file is imported from disk, so Node can see
// the hoisted copies at the repo root. Turbopack's PostCSS worker cannot:
// its require() does not walk out of apps/web.
//
// Tailwind CSS v4 (ADR 0022) reads app/tailwind.css, builds the utilities it
// finds in apps/web (base: this folder) and, in production, minifies and
// prefixes with Lightning CSS. Autoprefixer stays after it so the global rules
// in that sheet's `@layer base` (moved from the legacy sheets in migration
// T5.1) keep the prefixes they get today in dev and production alike.
module.exports = {
  plugins: [
    [require('@tailwindcss/postcss'), { base: __dirname }],
    [require('autoprefixer'), {}],
  ],
};
