import { describe, expect, it } from "vitest";
import { codeToPk, collectionsFromMedia, fromInstagramRead, type InstagramMedia } from "@/lib/instagram-read";
import { emptyLibrary, mergeImport } from "@/lib/library/ops";
import { estimateDuration, formatDuration, planPush, type PushPlan } from "@/lib/push";

function media(code: string, collectionIds: string[] = []): InstagramMedia {
  return { pk: `pk-${code}`, code, kind: "post", author: "a.b", caption: null, image: null, collectionIds };
}

/** What Instagram's saved list looks like after running a plan. */
function run(current: string[], plan: PushPlan): string[] {
  let list = [...current];
  for (const step of plan.steps) list = [step.code, ...list.filter((c) => c !== step.code)];
  return list;
}

describe("codeToPk", () => {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const toCode = (pk: bigint) => {
    let code = "";
    for (; pk > BigInt(0); pk /= BigInt(64)) code = ALPHABET[Number(pk % BigInt(64))] + code;
    return code;
  };

  it("reads a shortcode as a base-64 number", () => {
    expect(codeToPk("B")).toBe("1");
    expect(codeToPk("BA")).toBe("64");
    expect(codeToPk("_")).toBe("63");
  });

  it("round-trips 19-digit media ids, beyond what JS numbers hold", () => {
    for (const pk of ["1949924443218712766", "3456789012345678901", "9007199254740993"]) {
      expect(codeToPk(toCode(BigInt(pk)))).toBe(pk);
    }
  });

  it("ignores the extra characters on private-post shortcodes", () => {
    const code = toCode(BigInt("3456789012345678901"));
    expect(code).toHaveLength(11);
    expect(codeToPk(`${code}xYz123`)).toBe("3456789012345678901");
  });
});

describe("planPush", () => {
  const current = ["a", "b", "c", "d", "e"].map((c) => media(c));

  it("does nothing when Instagram already matches", () => {
    const plan = planPush(["a", "b", "c", "d", "e"], current);
    expect(plan.steps).toEqual([]);
    expect(plan.unchanged).toBe(5);
  });

  it("only re-saves what moved to the top", () => {
    const plan = planPush(["d", "a", "b", "c", "e"], current);
    expect(plan.steps.map((s) => s.code)).toEqual(["d"]);
    expect(plan.unchanged).toBe(4);
    expect(run(["a", "b", "c", "d", "e"], plan)).toEqual(["d", "a", "b", "c", "e"]);
  });

  it("re-saves everything above the first out-of-place post, bottom first", () => {
    const target = ["e", "d", "c", "b", "a"];
    const plan = planPush(target, current);
    expect(plan.steps.map((s) => s.code)).toEqual(["b", "c", "d", "e"]);
    expect(run(["a", "b", "c", "d", "e"], plan)).toEqual(target);
  });

  it("reaches any order", () => {
    const codes = Array.from({ length: 40 }, (_, i) => `p${i}`);
    const shuffled = [...codes].sort(() => Math.random() - 0.5);
    const plan = planPush(shuffled, codes.map((c) => media(c)));
    expect(run(codes, plan)).toEqual(shuffled);
  });

  it("puts re-saved posts back in their collections", () => {
    const plan = planPush(["b", "a"], [media("a", ["c1"]), media("b", ["c1", "c2"])]);
    expect(plan.steps).toEqual([{ code: "b", mediaId: "pk-b", action: "resave", collections: ["c1", "c2"] }]);
    expect(plan.actions).toBe(4);
  });

  it("leaves posts unsaved on Instagram alone, unless copying to another account", () => {
    const plan = planPush(["x", "a", "b"], [media("a"), media("b")]);
    expect(plan.steps).toEqual([]);
    expect(plan.notSaved).toEqual(["x"]);

    const copy = planPush(["BA", "a", "b"], [media("a"), media("b")], { saveMissing: true });
    expect(copy.steps).toEqual([{ code: "BA", mediaId: "64", action: "save", collections: [] }]);
  });

  it("counts posts saved on Instagram but not in Keeper", () => {
    expect(planPush(["b", "a"], current).onlyOnInstagram).toBe(3);
  });

  it("estimates time within the pace limits", () => {
    const few = planPush(["e", "a", "b", "c", "d"], current);
    expect(formatDuration(estimateDuration(few))).toBe("1 min");
    const many = planPush(
      Array.from({ length: 1000 }, (_, i) => `p${999 - i}`),
      Array.from({ length: 1000 }, (_, i) => media(`p${i}`)),
    );
    // 999 re-saves × 2 actions at 500 actions a day: 250 posts a day, the
    // last batch finishing a few hours into day 4.
    expect(formatDuration(estimateDuration(many))).toBe("3 days");
  });
});

describe("fromInstagramRead", () => {
  it("turns an extension read into an import", () => {
    const saved: InstagramMedia[] = [
      { pk: "1", code: "AAAAAAAAAAA", kind: "reel", author: "chef.maria", caption: "  Crispy tacos  ", image: "https://x/y.jpg", collectionIds: ["c1"] },
      { pk: "2", code: "BBBBBBBBBBB", kind: "post", author: null, caption: null, image: null, collectionIds: ["c1", "c2"] },
    ];
    const read = {
      account: { userId: "42", username: "ryan" },
      saved,
      collections: collectionsFromMedia(saved, [
        { id: "c1", name: "Recipes" },
        { id: "c2", name: "Travel" },
      ]),
    };
    const result = fromInstagramRead(read);
    expect(result.bookmarks).toEqual([
      { id: "AAAAAAAAAAA", kind: "reel", url: "https://www.instagram.com/reel/AAAAAAAAAAA/", mediaId: "1", author: "chef.maria", caption: "Crispy tacos" },
      { id: "BBBBBBBBBBB", kind: "post", url: "https://www.instagram.com/p/BBBBBBBBBBB/", mediaId: "2" },
    ]);
    expect(result.collections).toEqual([
      { name: "Recipes", instagramId: "c1", items: ["AAAAAAAAAAA", "BBBBBBBBBBB"] },
      { name: "Travel", instagramId: "c2", items: ["BBBBBBBBBBB"] },
    ]);

    // Merging over an export import fills in details and links collections by id.
    const fromExport = mergeImport(emptyLibrary(), {
      bookmarks: [{ id: "AAAAAAAAAAA", kind: "post", url: "https://www.instagram.com/p/AAAAAAAAAAA/", author: "chef.maria", savedAt: 5 }],
      collections: [{ name: "Recipes", items: ["AAAAAAAAAAA"] }],
      mergedDuplicates: 0,
      skipped: 0,
      warnings: [],
    }).library;
    const { library, summary } = mergeImport(fromExport, result);
    expect(library.bookmarks.AAAAAAAAAAA).toMatchObject({ kind: "reel", caption: "Crispy tacos", mediaId: "1", savedAt: 5 });
    expect(library.collections.map((c) => [c.name, c.instagramId, c.items])).toEqual([
      ["Recipes", "c1", ["BBBBBBBBBBB", "AAAAAAAAAAA"]],
      ["Travel", "c2", ["BBBBBBBBBBB"]],
    ]);
    expect(library.instagram).toEqual({ userId: "42", username: "ryan" });
    expect(summary).toEqual({ added: 1, updated: 1, collectionsAdded: 1 });
  });
});
