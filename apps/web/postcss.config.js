// Load the plugin here. This file is imported from disk, so Node can see
// the hoisted copies at the repo root. Turbopack's PostCSS worker cannot:
// its require() does not walk out of apps/web.
module.exports = {
  plugins: [
    [require('autoprefixer'), {}],
  ],
};
