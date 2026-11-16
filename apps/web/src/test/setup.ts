import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// findBy*/waitFor give up after 1s by default, which a loaded machine or CI
// runner can exceed while a page renders its queries; a real miss still fails.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
});
