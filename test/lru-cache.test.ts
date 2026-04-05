import { describe, it, expect } from "vitest";
import { LRUCache } from "../src/specs/lru-cache.js";

describe("LRUCache", () => {
  it("stores and retrieves values", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    expect(cache.size).toBe(2);
  });

  it("returns undefined for missing keys", () => {
    const cache = new LRUCache<string, number>(3);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts least recently used when full", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // evicts "a"
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("promotes on get", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // promote "a"
    cache.set("c", 3); // evicts "b" (least recent)
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("updates existing keys without growing", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(10);
  });

  it("supports has and delete", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    cache.delete("a");
    expect(cache.has("a")).toBe(false);
    expect(cache.size).toBe(0);
  });

  it("clears all entries", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });
});
