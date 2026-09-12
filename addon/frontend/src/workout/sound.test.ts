import { describe, expect, it } from "vitest";

import type { Context } from "./sound";
import { createAudio } from "./sound";

/** Resumes at once, where a real context resolves later. */
class FakeContext implements Context {
  state = "suspended";
  closed = false;

  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
}

function setUp() {
  const made: FakeContext[] = [];
  const audio = createAudio(() => {
    const context = new FakeContext();
    made.push(context);
    return context;
  });
  const nth = (i: number): FakeContext => {
    const context = made[i];
    if (!context) throw new Error(`no context ${i} was made`);
    return context;
  };
  return { audio, made, nth };
}

describe("unlocking audio", () => {
  it("has nothing to play on before the first tap", () => {
    const { audio, made } = setUp();
    expect(audio.playable()).toBeNull();
    expect(made).toHaveLength(0);
  });

  it("makes a context and resumes it", () => {
    const { audio, made } = setUp();
    audio.unlock();
    expect(made).toHaveLength(1);
    expect(audio.playable()).toBe(made[0]);
  });

  it("keeps a running context through later taps", () => {
    const { audio, made } = setUp();
    audio.unlock();
    audio.unlock();
    expect(made).toHaveLength(1);
  });

  it("replaces a context that isn't running", () => {
    const { audio, made, nth } = setUp();
    audio.unlock();
    nth(0).state = "interrupted";
    expect(audio.playable()).toBeNull();

    audio.unlock();
    expect(nth(0).closed).toBe(true);
    expect(audio.playable()).toBe(made[1]);
  });
});

describe("hiding the screen", () => {
  it("makes the context stale, however running it says it is", () => {
    const { audio, nth } = setUp();
    audio.unlock();
    audio.hide();
    expect(nth(0).state).toBe("running");
    expect(audio.playable()).toBeNull();
  });

  it("is recovered by the next tap, on a fresh context", () => {
    const { audio, made, nth } = setUp();
    audio.unlock();
    audio.hide();
    audio.unlock();
    expect(made).toHaveLength(2);
    expect(nth(0).closed).toBe(true);
    expect(audio.playable()).toBe(made[1]);
  });

  it("before any context exists changes nothing", () => {
    const { audio, made } = setUp();
    audio.hide();
    audio.unlock();
    expect(made).toHaveLength(1);
    expect(audio.playable()).toBe(made[0]);
  });
});

describe("never failing a workout over a beep", () => {
  it("replaces a context whose close fails", () => {
    const { audio, made, nth } = setUp();
    audio.unlock();
    nth(0).close = () => {
      throw new Error("already closed");
    };
    audio.hide();
    expect(() => audio.unlock()).not.toThrow();
    expect(audio.playable()).toBe(made[1]);
  });

  it("plays nothing when no context can be made", () => {
    const audio = createAudio<FakeContext>(() => {
      throw new Error("no audio here");
    });
    expect(() => audio.unlock()).not.toThrow();
    expect(audio.playable()).toBeNull();
  });
});
