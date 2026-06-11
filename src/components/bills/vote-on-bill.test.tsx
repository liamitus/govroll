// @vitest-environment jsdom
/**
 * Component-level guard for the roll-call vote card. Govroll's whole pitch
 * is legislative accuracy, so a card that says "Passed" under a failed
 * cloture or suspension is exactly the trust-eroding bug this card must not
 * ship. These tests render <RollCallCard> with the threshold-sensitive
 * tallies and assert the verdict reads correctly — never a bare-majority
 * "Passed".
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { RollCallVote } from "@/types";
import { RollCallCard } from "./vote-on-bill";

afterEach(() => {
  cleanup();
});

function rollCall(overrides: Partial<RollCallVote> = {}): RollCallVote {
  return {
    rollCallNumber: 1,
    chamber: "senate",
    votedAt: "2025-03-01T00:00:00.000Z",
    category: "passage",
    votes: [
      { vote: "Yea", count: 55 },
      { vote: "Nay", count: 45 },
    ],
    ...overrides,
  };
}

describe("RollCallCard verdict", () => {
  it("a 55-45 cloture renders as failed, NOT passed", () => {
    render(<RollCallCard rollCall={rollCall({ category: "cloture" })} />);

    expect(screen.queryByText(/passed/i)).toBeNull();
    expect(screen.getByText(/cloture failed · 55-45/i)).toBeInTheDocument();
  });

  it("a 250-180 suspension renders as failed, NOT passed", () => {
    render(
      <RollCallCard
        rollCall={rollCall({
          chamber: "house",
          category: "passage_suspension",
          votes: [
            { vote: "Aye", count: 250 },
            { vote: "No", count: 180 },
          ],
        })}
      />,
    );

    expect(screen.queryByText(/passed/i)).toBeNull();
    expect(
      screen.getByText(/suspension failed · 250-180/i),
    ).toBeInTheDocument();
  });

  it("an ordinary 55-45 passage vote does pass", () => {
    render(<RollCallCard rollCall={rollCall({ category: "passage" })} />);

    expect(screen.getByText(/passed 55-45/i)).toBeInTheDocument();
  });

  it("an amendment shows the tally without a pass/fail verdict", () => {
    render(<RollCallCard rollCall={rollCall({ category: "amendment" })} />);

    expect(screen.queryByText(/passed/i)).toBeNull();
    expect(screen.queryByText(/failed/i)).toBeNull();
    expect(screen.getByText(/amendment · 55-45/i)).toBeInTheDocument();
  });
});
