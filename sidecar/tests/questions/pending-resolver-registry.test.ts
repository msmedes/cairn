import { expect, test } from "bun:test";
import { PendingResolverRegistry } from "../../questions/pending-resolver-registry";

type Result = { ok: true; value: string };

test("pending resolver registers and resolves by id", async () => {
  const registry = new PendingResolverRegistry<Result>();
  const pending = registry.registerPending("tool-call-1");

  expect(
    registry.resolvePending("tool-call-1", { ok: true, value: "yes" }),
  ).toBe(true);
  await expect(pending).resolves.toEqual({ ok: true, value: "yes" });
});

test("pending resolver reports unknown ids without throwing", () => {
  const registry = new PendingResolverRegistry<Result>();

  expect(
    registry.resolvePending("missing", { ok: true, value: "ignored" }),
  ).toBe(false);
});

test("pending resolver cancelAll rejects every pending entry", async () => {
  const registry = new PendingResolverRegistry<Result>();
  const first = registry.registerPending("first");
  const second = registry.registerPending("second");

  registry.cancelAllPending("session closed");

  await expect(first).rejects.toThrow("session closed");
  await expect(second).rejects.toThrow("session closed");
});
