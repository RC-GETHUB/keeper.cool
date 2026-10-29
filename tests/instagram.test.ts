import { describe, expect, it } from "vitest";
import { fixMojibake, isUsername, parsePostUrl } from "@/lib/instagram";

describe("parsePostUrl", () => {
  it.each([
    ["https://www.instagram.com/p/C0aBcD1eFgH/", "C0aBcD1eFgH", "post"],
    ["https://instagram.com/p/C0aBcD1eFgH", "C0aBcD1eFgH", "post"],
    ["https://www.instagram.com/reel/C0aBcD1eFgH/?igsh=abc", "C0aBcD1eFgH", "reel"],
    ["https://www.instagram.com/reels/C0aBcD1eFgH/", "C0aBcD1eFgH", "reel"],
    ["https://www.instagram.com/tv/C0aBcD1eFgH/", "C0aBcD1eFgH", "tv"],
    ["https://www.instagram.com/chef.maria/p/C0aBcD1eFgH/", "C0aBcD1eFgH", "post"],
    ["https://m.instagram.com/p/C0a-cD_eFgH/", "C0a-cD_eFgH", "post"],
    ["instagr.am/p/C0aBcD1eFgH", "C0aBcD1eFgH", "post"],
  ])("reads %s", (url, id, kind) => {
    expect(parsePostUrl(url)).toMatchObject({ id, kind });
  });

  it("builds a canonical url", () => {
    expect(parsePostUrl("https://instagram.com/reels/C0aBcD1eFgH?x=1")?.url).toBe("https://www.instagram.com/reel/C0aBcD1eFgH/");
  });

  it.each(["https://www.instagram.com/chef.maria/", "https://example.com/p/C0aBcD1eFgH/", "not a url", ""])(
    "rejects %s",
    (url) => expect(parsePostUrl(url)).toBeNull(),
  );
});

describe("fixMojibake", () => {
  it("repairs Meta's double-encoded UTF-8", () => {
    expect(fixMojibake("cafÃ©")).toBe("café");
    expect(fixMojibake("ð\u009f\u008d\u009d Pasta")).toBe("🍝 Pasta");
  });
  it("leaves normal text alone", () => {
    expect(fixMojibake("café")).toBe("café");
    expect(fixMojibake("Recipes 🍝")).toBe("Recipes 🍝");
    expect(fixMojibake("Ã on its own")).toBe("Ã on its own");
  });
});

describe("isUsername", () => {
  it("accepts instagram handles", () => {
    expect(isUsername("chef.maria")).toBe(true);
    expect(isUsername("run_with_sam")).toBe(true);
  });
  it("rejects other text", () => {
    expect(isUsername("Collection name")).toBe(false);
    expect(isUsername(".dot")).toBe(false);
    expect(isUsername("")).toBe(false);
  });
});
