import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { withDom } from "../../test/dom";
import { Icon } from "./Icon";
import { ICON_NAMES, ICONS } from "./icons";

withDom();

describe("icons", () => {
  test("every path is made of horizontal and vertical steps only", () => {
    for (const name of ICON_NAMES) {
      const shape = ICONS[name] as { d: string; layers?: Array<{ d: string }> };
      for (const d of shape.layers ? shape.layers.map((l) => l.d) : [shape.d]) {
        expect(d).toMatch(/^[MHVhvz0-9 .-]+$/);
      }
    }
  });

  test("decorative by default, labelled when it carries meaning", () => {
    const { container, getByRole } = render(
      <>
        <Icon name="bomb" />
        <Icon name="coin" label="Монеты" size={24} />
      </>,
    );
    const [plain] = container.querySelectorAll("svg");
    expect(plain?.getAttribute("aria-hidden")).toBe("true");
    const coin = getByRole("img", { name: "Монеты" });
    expect(coin.getAttribute("width")).toBe("24");
    expect(coin.querySelectorAll("path")).toHaveLength(2);
  });
});
