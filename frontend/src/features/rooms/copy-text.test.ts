import { copyText } from "./copy-text";

describe("copyText", () => {
  it("uses the modern Clipboard API when it is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await copyText("https://example.test/rooms/abc", { writeText });

    expect(writeText).toHaveBeenCalledWith("https://example.test/rooms/abc");
  });

  it("falls back to the browser copy command when Clipboard API rejects in HTTP LAN", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    try {
      await copyText("room-id", { writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(document, "execCommand", originalDescriptor);
      } else {
        Reflect.deleteProperty(document, "execCommand");
      }
    }

    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
