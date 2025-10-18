
import { Cl } from "@stacks/transactions";
import { beforeEach, describe, expect, it } from "vitest";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const alice = accounts.get("wallet_1")!;
const bob = accounts.get("wallet_2")!;

const mockTokenOne = Cl.contractPrincipal(deployer, "mock-token");
const mockTokenTwo = Cl.contractPrincipal(deployer, "mock-token-2");

describe("Mock Token Faucet", () => {
  beforeEach(() => {
    // Reset state between tests by minting small amounts to known accounts
    const res1 = simnet.callPublicFn(
      "mock-token",
      "mint",
      [Cl.uint(1000), Cl.principal(alice)],
      alice
    );
    expect(res1.events.length).toBeGreaterThan(0);

    const res2 = simnet.callPublicFn(
      "mock-token-2",
      "mint",
      [Cl.uint(1000), Cl.principal(alice)],
      alice
    );
    expect(res2.events.length).toBeGreaterThan(0);
  });

  it("allows permissionless mint to any principal", () => {
    const amount = 500_000;

    const mintA1 = simnet.callPublicFn(
      "mock-token",
      "mint",
      [Cl.uint(amount), Cl.principal(bob)],
      bob
    );
    expect(mintA1.events.length).toBeGreaterThan(0);

    const mintA2 = simnet.callPublicFn(
      "mock-token-2",
      "mint",
      [Cl.uint(amount), Cl.principal(bob)],
      bob
    );
    expect(mintA2.events.length).toBeGreaterThan(0);

    const bal1 = simnet.callReadOnlyFn(
      "mock-token",
      "get-balance",
      [Cl.principal(bob)],
      bob
    );
    expect(bal1.result).toBeOk(Cl.uint(amount));

    const bal2 = simnet.callReadOnlyFn(
      "mock-token-2",
      "get-balance",
      [Cl.principal(bob)],
      bob
    );
    expect(bal2.result).toBeOk(Cl.uint(amount));
  });

  it("enforces transfer sender to be tx-sender", () => {
    // Mint to Alice
    simnet.callPublicFn("mock-token", "mint", [Cl.uint(1000), Cl.principal(alice)], alice);

    // Attempt transfer where tx-sender != sender should fail
    const transferRes = simnet.callPublicFn(
      "mock-token",
      "transfer",
      [Cl.uint(100), Cl.principal(alice), Cl.principal(bob), Cl.none()],
      bob // bob is tx-sender, but sender=alice
    );
    expect(transferRes.result).toBeErr(Cl.uint(101)); // err-not-token-owner
  });
});
