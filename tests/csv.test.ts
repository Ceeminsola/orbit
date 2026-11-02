import { describe, expect, it } from "vitest";
import { safeCell, toCsv } from "../src/lib/csv";
describe("csv formula-injection protection", () => {
  it.each(["=1+1", " +cmd", "\t-2", "@SUM(A1)", "\r=x"])("neutralises %j", v => expect(safeCell(v).startsWith("'")).toBe(true));
  it("leaves normal text alone", () => { expect(safeCell("hello")).toBe("hello"); expect(safeCell("a=b")).toBe("a=b"); });
  it("quotes and escapes cells", () => { expect(toCsv([{ a: 'x"y', b: "=1" }], ["a", "b"])).toBe('a,b\n"x""y","\'=1"'); });
});
