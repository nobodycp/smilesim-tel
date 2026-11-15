// Load the plugins here. This file is imported from disk, so Node can see
// the hoisted copies at the repo root. Turbopack's PostCSS worker cannot:
// its require() does not walk out of apps/web.
//
// Tailwind CSS v4 (ADR 0022) inlines app/globals.css's imports, builds the
// utilities it finds in apps/web (base: this folder) and, in production,
// minifies and prefixes with Lightning CSS. Autoprefixer stays after it so the
// legacy sheets keep the prefixes they get today in dev and production alike.
module.exports = {
  plugins: [
    [require('@tailwindcss/postcss'), { base: __dirname }],
    [require('autoprefixer'), {}],
  ],
};
