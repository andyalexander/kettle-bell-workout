import { describe, expect, it } from "vitest";

import indexHtml from "../index.html?raw";
import manifestJson from "../public/manifest.webmanifest?raw";

/**
 * Everything in `public/`, which the build copies to the site root: a link to
 * `/favicon.ico` resolves only if `../public/favicon.ico` is a key here.
 */
const publicFiles = new Set(
  Object.keys(import.meta.glob("../public/*")).map((path) =>
    path.replace("../public/", "/"),
  ),
);

const LINKED_FILE = /<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g;

const pageLinks = [...indexHtml.matchAll(LINKED_FILE)].map((match) => match[1]);
const manifestIcons = (JSON.parse(manifestJson) as { icons: { src: string }[] }).icons.map(
  (icon) => icon.src,
);

describe("the icons the page promises", () => {
  it("links a favicon.ico, since iOS bookmarks and browsers ask for it by name", () => {
    expect(pageLinks).toContain("/favicon.ico");
  });

  it.each(pageLinks)("ships %s, linked from index.html", (href) => {
    expect(publicFiles).toContain(href);
  });

  it.each(manifestIcons)("ships %s, listed in the manifest", (src) => {
    expect(publicFiles).toContain(src);
  });
});
