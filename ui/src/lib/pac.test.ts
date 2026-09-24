import { describe, expect, it } from "vitest";
import { PAC_HELPERS, evaluatePac, hostOf, pacTargets } from "./pac";

/** Calls one helper with the given arguments. */
const helper = (expr: string) => new Function(`${PAC_HELPERS}\nreturn ${expr};`)();

describe("PAC helpers", () => {
  it("host name checks", () => {
    expect(helper(`isPlainHostName("intranet")`)).toBe(true);
    expect(helper(`isPlainHostName("www.firma.de")`)).toBe(false);
    expect(helper(`dnsDomainIs("wiki.Firma.de", ".firma.de")`)).toBe(true);
    expect(helper(`dnsDomainIs("firma.de.evil.com", ".firma.de")`)).toBe(false);
    expect(helper(`localHostOrDomainIs("www", "www.firma.de")`)).toBe(true);
    expect(helper(`localHostOrDomainIs("www.firma.de", "www.firma.de")`)).toBe(true);
    expect(helper(`localHostOrDomainIs("home.firma.de", "www.firma.de")`)).toBe(false);
    expect(helper(`dnsDomainLevels("a.b.c")`)).toBe(2);
    expect(helper(`dnsDomainLevels("intranet")`)).toBe(0);
    expect(helper(`isResolvable("egal")`)).toBe(true);
  });

  it("shell expressions", () => {
    expect(helper(`shExpMatch("http://www.firma.de/x", "*.firma.de/*")`)).toBe(true);
    expect(helper(`shExpMatch("llm.firma.de", "llm.firma.??")`)).toBe(true);
    expect(helper(`shExpMatch("llmXfirma.de", "llm.firma.de")`)).toBe(false);
    expect(helper(`shExpMatch("a(b)[c]", "a(b)[c]")`)).toBe(true);
  });

  it("addresses without DNS", () => {
    expect(helper(`isInNet("10.1.2.3", "10.0.0.0", "255.0.0.0")`)).toBe(true);
    expect(helper(`isInNet("11.1.2.3", "10.0.0.0", "255.0.0.0")`)).toBe(false);
    expect(helper(`isInNet("192.168.10.7", "192.168.10.0", "255.255.255.0")`)).toBe(true);
    // Host names cannot be resolved: never in a network.
    expect(helper(`isInNet("intranet.firma.de", "10.0.0.0", "255.0.0.0")`)).toBe(false);
    expect(helper(`isInNet(dnsResolve("intranet.firma.de"), "10.0.0.0", "255.0.0.0")`)).toBe(false);
    expect(helper(`dnsResolve("10.0.0.1")`)).toBe("10.0.0.1");
    expect(helper(`dnsResolve("www.firma.de")`)).toBe(null);
    expect(helper(`myIpAddress()`)).toBe("127.0.0.1");
    expect(helper(`convert_addr("1.0.0.1")`)).toBe(16777217);
  });

  it("time, day and date ranges", () => {
    const now = new Date();
    const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const today = days[now.getDay()];
    expect(helper(`weekdayRange("${today}")`)).toBe(true);
    expect(helper(`weekdayRange("SUN", "SAT")`)).toBe(true);
    expect(helper(`timeRange(0, 24)`)).toBe(true);
    expect(helper(`timeRange(${now.getHours()})`)).toBe(true);
    expect(helper(`dateRange(${now.getFullYear()})`)).toBe(true);
    expect(helper(`dateRange(${now.getFullYear() + 1})`)).toBe(false);
    expect(helper(`dateRange("JAN", "DEC")`)).toBe(true);
    expect(helper(`dateRange(1, 31)`)).toBe(true);
    expect(helper(`weekdayRange("XYZ")`)).toBe(false);
  });
});

const SAMPLE = `
function FindProxyForURL(url, host) {
  if (isPlainHostName(host) || dnsDomainIs(host, ".firma.local") || shExpMatch(host, "10.*")) return "DIRECT";
  if (isInNet(host, "192.168.0.0", "255.255.0.0")) return "DIRECT";
  if (shExpMatch(url, "https://github.com/*")) return "PROXY git-proxy.firma.de:3128";
  if (localHostOrDomainIs(host, "llm.firma.de")) return "PROXY llm-proxy:8080; DIRECT";
  return "PROXY proxy.firma.de:8080; SOCKS socks.firma.de:1080";
}`;

describe("FindProxyForURL", () => {
  it("evaluates a sample PAC per URL", () => {
    expect(evaluatePac(SAMPLE, "http://intranet/")).toBe("DIRECT");
    expect(evaluatePac(SAMPLE, "https://wiki.firma.local/x")).toBe("DIRECT");
    expect(evaluatePac(SAMPLE, "http://10.1.1.1:4000/v1")).toBe("DIRECT");
    expect(evaluatePac(SAMPLE, "http://192.168.3.4/")).toBe("DIRECT");
    expect(evaluatePac(SAMPLE, "https://github.com/firma/notizen.git")).toBe("PROXY git-proxy.firma.de:3128");
    expect(evaluatePac(SAMPLE, "https://llm.firma.de/v1/models")).toBe("PROXY llm-proxy:8080; DIRECT");
    expect(evaluatePac(SAMPLE, "https://api.openai.com/")).toBe("PROXY proxy.firma.de:8080; SOCKS socks.firma.de:1080");
  });

  it("reports PAC errors", () => {
    expect(() => evaluatePac("function FindProxyForURL(u, h) { return undefinedThing(); }", "https://x.de")).toThrow();
    expect(() => evaluatePac("kein javascript (", "https://x.de")).toThrow();
  });

  it("targets: LiteLLM as default plus the other hosts once", () => {
    expect(hostOf("https://[::1]:4000/x")).toBe("::1");
    expect(hostOf("kaputt")).toBe(null);
    expect(pacTargets("https://llm.firma.de", ["https://github.com/a.git", "https://github.com/b", "git@x:y"])).toEqual([
      { key: "*", url: "https://llm.firma.de" },
      { key: "github.com", url: "https://github.com/a.git" },
      { key: "llm.firma.de", url: "https://llm.firma.de" },
    ]);
  });
});
