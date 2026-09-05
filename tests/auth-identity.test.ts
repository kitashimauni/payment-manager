import { describe, expect, it } from "vitest";
import { googleUserId } from "../src/lib/auth-identity";

describe("Google user identity", () => {
  it("keeps the provider namespace in the persisted user ID", () => {
    expect(googleUserId("107845239012345678901")).toBe("google:107845239012345678901");
  });

  it("normalizes surrounding whitespace before creating the ID", () => {
    expect(googleUserId("  stable-subject  ")).toBe("google:stable-subject");
  });

  it("rejects an empty subject", () => {
    expect(() => googleUserId("   ")).toThrow("Google subject must not be empty");
  });
});
