import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PaletteEntry } from "@rave/shared/client";
import { act, fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import { applyLocale } from "../../i18n";
import { withDom } from "../../test/dom";
import { Avatar, avatarColor, initialOf } from "./Avatar";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Field, Input } from "./Field";
import { Segmented } from "./Segmented";
import { heightAfterDrag, Sheet, type SheetHeight } from "./Sheet";
import { Swatch, swatchBackground } from "./Swatch";
import { Tabs } from "./Tabs";

withDom();
/** `screen` binds to the document at import time, before the per-file DOM exists; query the body at call time instead. */
const screen = {
  get current() {
    return within(document.body);
  },
};
beforeEach(() => applyLocale("ru"));

const PERIODS = [
  { value: "day", label: "День" },
  { value: "week", label: "7 дней" },
  { value: "all", label: "Всё время" },
] as const;

function PeriodPicker() {
  const [value, setValue] = useState<"day" | "week" | "all">("day");
  return <Segmented label="Период" options={PERIODS} value={value} onChange={setValue} />;
}

describe("Segmented", () => {
  test("one tab stop; arrows, Home and End move the choice and focus, wrapping", () => {
    render(<PeriodPicker />);
    const radios = screen.current.getAllByRole("radio");
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    radios[0]!.focus();
    fireEvent.keyDown(radios[0]!, { key: "ArrowRight" });
    expect(screen.current.getByRole("radio", { name: "7 дней" }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radios[1]!);
    fireEvent.keyDown(radios[1]!, { key: "End" });
    expect(document.activeElement).toBe(radios[2]!);
    fireEvent.keyDown(radios[2]!, { key: "ArrowRight" });
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(radios[2]!);
    expect(screen.current.getAllByRole("radio").map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
  });
});

describe("Tabs", () => {
  test("arrow keys switch tabs and the panel is labelled by the selected tab", () => {
    function Panel() {
      const [tab, setTab] = useState<"shop" | "daily">("shop");
      return (
        <Tabs
          label="Разделы"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "shop", label: "Магазин" },
            { id: "daily", label: "Награда" },
          ]}
        >
          <p>{tab}</p>
        </Tabs>
      );
    }
    render(<Panel />);
    const [shop] = screen.current.getAllByRole("tab");
    fireEvent.keyDown(shop!, { key: "ArrowLeft" });
    expect(screen.current.getByRole("tab", { name: "Награда" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.current.getByRole("tabpanel").textContent).toBe("daily");
    expect(screen.current.getByRole("tabpanel", { name: "Награда" })).toBeTruthy();
  });
});

describe("Sheet", () => {
  test("heightAfterDrag: one height per 60 px, dragging below the lowest closes", () => {
    expect(heightAfterDrag("half", -70)).toBe("full");
    expect(heightAfterDrag("half", -500)).toBe("full");
    expect(heightAfterDrag("half", 30)).toBe("half");
    expect(heightAfterDrag("half", 70)).toBe("peek");
    expect(heightAfterDrag("peek", 70)).toBeNull();
  });

  test("takes focus on open, gives it back on close; tapping the handle cycles heights; Esc closes", () => {
    const onClose = mock(() => {});
    function Host() {
      const [open, setOpen] = useState(false);
      const [height, setHeight] = useState<SheetHeight>("half");
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            open
          </button>
          <Sheet
            open={open}
            height={height}
            onHeightChange={setHeight}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            label="Чат"
          >
            <p>body</p>
          </Sheet>
        </>
      );
    }
    render(<Host />);
    const opener = screen.current.getByRole("button", { name: "open" });
    opener.focus();
    fireEvent.click(opener);
    const sheet = screen.current.getByRole("dialog", { name: "Чат" });
    expect(document.activeElement).toBe(sheet);
    fireEvent.click(screen.current.getByRole("button", { name: "Высота панели" }));
    expect(sheet.getAttribute("data-height")).toBe("full");
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.current.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("ConfirmDialog", () => {
  test("names the action, confirms and cancels", () => {
    const onConfirm = mock(() => {});
    const onCancel = mock(() => {});
    render(
      <ConfirmDialog open title="Забанить griefer_01?" confirmLabel="Заблокировать навсегда" danger onConfirm={onConfirm} onCancel={onCancel}>
        Он не сможет играть.
      </ConfirmDialog>,
    );
    fireEvent.click(screen.current.getByRole("button", { name: "Заблокировать навсегда", hidden: true }));
    fireEvent.click(screen.current.getByRole("button", { name: "Отмена", hidden: true }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("Swatch", () => {
  const solid: PaletteEntry = { id: 32, type: "solid", base: "#FF00E5", unlock: "shop", price: 200, params: {}, name: { ru: "Неон-розовый", en: "Neon pink" } };
  const gradient: PaletteEntry = {
    id: 46,
    type: "gradient",
    base: "#FF3881",
    unlock: "shop",
    price: 1000,
    params: { stops: ["#BC13FE", "#FF3881"], scale: 32, angle: 0, speed: 0 },
  };

  test("a radio named after the colour, in the interface language, with effect and lock", () => {
    const onSelect = mock(() => {});
    render(
      <div role="radiogroup" aria-label="Цвет">
        <Swatch entry={solid} selected onSelect={onSelect} />
        <Swatch entry={gradient} locked />
      </div>,
    );
    expect(screen.current.getByRole("radio", { name: "Неон-розовый" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.current.getByRole("radio", { name: "#46, Эффект, Закрыто" })).toBeTruthy();
    fireEvent.click(screen.current.getByRole("radio", { name: "Неон-розовый" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    act(() => applyLocale("en"));
    expect(screen.current.getByRole("radio", { name: "Neon pink" })).toBeTruthy();
  });

  test("background: solid colour, gradients as their looping stops", () => {
    expect(swatchBackground(solid, 0)).toBe("#FF00E5");
    expect(swatchBackground(gradient, 0)).toBe("linear-gradient(90deg, #BC13FE, #FF3881, #BC13FE)");
  });
});

describe("Avatar", () => {
  test("initial on a colour from the id; falls back from a broken picture", () => {
    expect(initialOf("  ёжик")).toBe("Ё");
    expect(initialOf("")).toBe("?");
    expect(avatarColor(7)).toBe(avatarColor(13));
    const { container } = render(<Avatar user={{ id: 3, name: "pixelwitch" }} src="https://cdn.example/a.png" />);
    const img = container.querySelector("img")!;
    fireEvent.error(img);
    expect(container.textContent).toBe("P");
  });
});

describe("Field and Button", () => {
  test("label, hint and error are tied to the control", () => {
    render(
      <Field label="Заморозка" unit="секунд" hint="Действия заблокированы" error="Не меньше 0">
        {(control) => <Input {...control} defaultValue="-1" changed />}
      </Field>,
    );
    const input = screen.current.getByLabelText("Заморозка");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("data-changed")).toBe("true");
    const described = input
      .getAttribute("aria-describedby")!
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(["Действия заблокированы", "Не меньше 0"]);
  });

  test("buttons do not submit forms unless asked", () => {
    render(<Button icon="bomb">Купить</Button>);
    expect(screen.current.getByRole("button", { name: "Купить" }).getAttribute("type")).toBe("button");
  });
});
