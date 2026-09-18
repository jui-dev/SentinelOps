import axe from "axe-core";
import { expect } from "vitest";

/**
 * Runs axe-core over a rendered container and fails with a readable list of
 * violations.
 *
 * Two rules are off, and both are covered elsewhere: `color-contrast` needs
 * real rendering, which jsdom does not do (design-tokens.test.ts checks every
 * token pair in both themes instead), and `region` expects a whole page with
 * landmarks, while these tests render parts of one (the shell's landmarks are
 * tested in workspace-shell.test.tsx).
 */
export const expectNoAxeViolations = async (container: Element) => {
  const results = await axe.run(container, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
    },
  });

  const violations = results.violations.map(
    ({ id, help, nodes }) =>
      `${id}: ${help}\n${nodes.map((node) => `  ${node.target.join(" ")}`).join("\n")}`,
  );

  expect(violations).toEqual([]);
};
