import { afterEach, describe, expect, it, vi } from "vitest";

import { createHostSeekController } from "./host-seek-controller";

function createVideoElement({ currentTime = 0, duration = 120 } = {}) {
  const listeners = new Map<string, Set<EventListener>>();
  const writtenTimes: number[] = [];
  let value = currentTime;

  return {
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, new Set([...(listeners.get(type) ?? []), listener]));
    },
    currentTime: {
      get value() {
        return value;
      },
      set value(next: number) {
        value = next;
        writtenTimes.push(next);
      },
    },
    duration,
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener(new Event(type));
      }
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener);
    },
    seeking: false,
    writtenTimes,
  };
}

function asVideoElement(video: ReturnType<typeof createVideoElement>) {
  const videoElement = {
    addEventListener: video.addEventListener,
    duration: video.duration,
    emit: video.emit,
    removeEventListener: video.removeEventListener,
    seeking: video.seeking,
  };

  Object.defineProperty(videoElement, "currentTime", {
    get: () => video.currentTime.value,
    set: (next) => {
      video.currentTime.value = next as number;
    },
  });

  return videoElement as unknown as Pick<
    HTMLVideoElement,
    "addEventListener" | "currentTime" | "duration" | "removeEventListener" | "seeking"
  >;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createHostSeekController", () => {
  it("применяет только последнее положение после серии быстрых seek", () => {
    const video = createVideoElement();
    const controller = createHostSeekController(asVideoElement(video));

    controller.seek(15);
    controller.seek(42);
    controller.seek(87);

    expect(video.writtenTimes).toEqual([15]);

    video.emit("seeked");

    expect(video.writtenTimes).toEqual([15, 87]);
  });

  it("подтверждает UI только после последнего seek из очереди", () => {
    const video = createVideoElement();
    const controller = createHostSeekController(asVideoElement(video));
    const firstComplete = vi.fn();
    const lastComplete = vi.fn();

    controller.seek(15, firstComplete);
    controller.seek(42, lastComplete);
    video.emit("seeked");

    expect(firstComplete).not.toHaveBeenCalled();
    expect(lastComplete).not.toHaveBeenCalled();
    expect(video.writtenTimes).toEqual([15, 42]);

    video.emit("seeked");

    expect(lastComplete).toHaveBeenCalledTimes(1);
  });

  it("освобождает очередь по timeout, если браузер не прислал seeked", () => {
    vi.useFakeTimers();
    const video = createVideoElement();
    const controller = createHostSeekController(asVideoElement(video));

    controller.seek(15);
    controller.seek(42);

    vi.advanceTimersByTime(1_500);

    expect(video.writtenTimes).toEqual([15, 42]);
  });

  it("не позволяет перемотать за границу длительности", () => {
    const video = createVideoElement({ currentTime: 20, duration: 120 });
    const controller = createHostSeekController(asVideoElement(video));

    controller.seek(-5);

    expect(video.writtenTimes).toEqual([0]);

    video.emit("seeked");
    controller.seek(240);

    expect(video.writtenTimes).toEqual([0, 119.99]);
  });

  it("после dispose не оставляет обработчик и не меняет video", () => {
    const video = createVideoElement();
    const controller = createHostSeekController(asVideoElement(video));

    controller.dispose();
    controller.seek(42);
    video.emit("seeked");

    expect(video.writtenTimes).toEqual([]);
  });
});
