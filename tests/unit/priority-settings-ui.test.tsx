/**
 * Priority settings UI tests.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrioritySettings } from "@jarv1s/settings-ui";

describe("PrioritySettings", () => {
  it("renders loading state", () => {
    render(<PrioritySettings />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders mode selector", async () => {
    render(<PrioritySettings />);
    // Wait for data to load
    const modeSelect = await screen.findByLabelText(/priority mode/i);
    expect(modeSelect).toBeInTheDocument();
  });

  it("renders anchors list", async () => {
    render(<PrioritySettings />);
    const anchorsHeader = await screen.findByText(/anchors/i);
    expect(anchorsHeader).toBeInTheDocument();
  });

  it("renders muted sources checkboxes", async () => {
    render(<PrioritySettings />);
    const mutedLabel = await screen.findByText(/muted sources/i);
    expect(mutedLabel).toBeInTheDocument();
  });

  it("adds new anchor", async () => {
    const onSuccess = vi.fn();
    render(<PrioritySettings onSuccess={onSuccess} />);
    const addButton = await screen.findByRole("button", { name: /add anchor/i });
    addButton.click();
    // Should trigger mutation
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("toggles muted source", async () => {
    render(<PrioritySettings />);
    const tasksCheckbox = await screen.findByRole("checkbox", { name: /tasks/i });
    tasksCheckbox.click();
    // Should trigger mutation
    await waitFor(() => expect(screen.getByText(/saving/i)).toBeInTheDocument());
  });
});
