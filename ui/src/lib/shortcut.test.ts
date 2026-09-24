import { describe, expect, it } from "vitest";
import { recordShortcut } from "./shortcut";

const key = (code: string, key: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) =>
  recordShortcut({ code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe("recordShortcut", () => {
  it("builds the spec from modifiers and the physical key", () => {
    expect(key("Space", " ", { ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+Space");
    expect(key("KeyY", "z", { ctrlKey: true })).toBe("Ctrl+Y");
    expect(key("Digit1", "!", { altKey: true, shiftKey: true })).toBe("Alt+Shift+1");
    expect(key("ArrowUp", "ArrowUp", { metaKey: true })).toBe("Super+Up");
    expect(key("F9", "F9")).toBe("F9");
  });
  it("waits for a key, clears, and lets Tab/Esc through", () => {
    expect(key("ShiftLeft", "Shift", { shiftKey: true })).toBeNull();
    expect(key("KeyA", "a")).toBeNull();
    expect(key("Backspace", "Backspace")).toBe("");
    expect(key("Delete", "Delete")).toBe("");
    expect(key("Tab", "Tab")).toBeUndefined();
    expect(key("Escape", "Escape")).toBeUndefined();
  });
  it("refuses Ctrl+Alt and AltGr (they type @, € … on German keyboards)", () => {
    expect(key("KeyQ", "@", { ctrlKey: true, altKey: true })).toBeNull();
    expect(key("KeyK", "k", { ctrlKey: true, altKey: true, shiftKey: true })).toBeNull();
    expect(key("AltRight", "AltGraph")).toBeNull();
    const altGr = { code: "KeyE", key: "€", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, getModifierState: (m: string) => m === "AltGraph" };
    expect(recordShortcut(altGr)).toBeNull();
    expect(key("KeyK", "k", { altKey: true, shiftKey: true })).toBe("Alt+Shift+K");
  });
});
