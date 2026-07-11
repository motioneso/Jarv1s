import { describe, expect, it } from "vitest";

import {
  discoverFeedUrls,
  extractListingHeadlines,
  sampleFeedHeadlines
} from "../../packages/news/src/discovery/feed-discovery.js";
import { TITLE_CHAR_CAP } from "../../packages/news/src/source/sanitize.js";

describe("news feed discovery", () => {
  it("finds at most three same-publisher HTTPS RSS/Atom links", () => {
    const html = `<head>
      <link rel="alternate" type="application/rss+xml" href="/rss.xml">
      <link rel="alternate stylesheet" type="application/atom+xml" href="https://feeds.example.com/atom.xml">
      <link rel="alternate" type="application/rss+xml" href="http://example.com/insecure.xml">
      <link rel="alternate" type="application/rss+xml" href="https://evil.test/rss.xml">
    </head>`;
    expect(discoverFeedUrls(html, "https://www.example.com/")).toEqual([
      "https://www.example.com/rss.xml",
      "https://feeds.example.com/atom.xml"
    ]);
  });

  it("extracts sanitized, useful same-publisher listing links", () => {
    const html = `<main>
      <a href="/story"><b>Major &amp; consequential</b> story develops today</a>
      <a href="/about">About</a>
      <a href="https://evil.test/story">A sufficiently long off-domain headline</a>
      <a href="http://example.com/insecure">A sufficiently long insecure headline</a>
    </main>`;
    expect(extractListingHeadlines(html, "https://example.com/", 5)).toEqual([
      {
        headline: "Major & consequential story develops today",
        url: "https://example.com/story"
      }
    ]);
  });

  it("samples feed items through existing sanitizers", () => {
    const xml = `<rss><channel><item>
      <title><![CDATA[<b>${"Headline ".repeat(50)}</b>]]></title>
      <link>https://example.com/story</link>
      <pubDate>Fri, 11 Jul 2026 12:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const [item] = sampleFeedHeadlines(xml, 1);
    expect(item?.headline.length).toBeLessThanOrEqual(TITLE_CHAR_CAP + 1);
    expect(item).toMatchObject({
      url: "https://example.com/story",
      publishedAt: "2026-07-11T12:00:00.000Z"
    });
  });
});
