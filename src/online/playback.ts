import { TICK_RATE } from '../core/constants';
import type { Command, Frame } from './protocol';

/** Server messages arrive at 20 Hz; presentation consumes approved ticks at render cadence.
 * No client acknowledgements or host clock are involved in advancing the server. */
export class OnlinePlayback {
  private steps: Command[][] = [];
  private head = 0;
  private received = 0;
  private fraction = 0;
  private started = false;
  private startWait = 0;
  get pendingTicks() { return this.steps.length - this.head; }
  get receivedTick() { return this.received; }
  get alpha() { return this.pendingTicks ? Math.min(1, this.fraction) : 1; }

  receive(frame: Frame) {
    if (frame.from !== this.received || !frame.steps.length) return false;
    this.steps.push(...frame.steps);
    this.received += frame.steps.length;
    return true;
  }

  advance(seconds: number, step: (commands: Command[], catchingUp: boolean) => void, hasBudget = () => true) {
    // One packet of reserve absorbs ordinary arrival jitter without speculative physics.
    if (!this.started) {
      if (!this.pendingTicks) return 0;
      this.startWait += seconds;
      if (this.pendingTicks < 12 && this.startWait < 0.1) return 0;
      this.started = true;
    }
    this.fraction += Math.max(0, Math.min(seconds, 0.25)) * TICK_RATE;
    const catchingUp = this.pendingTicks > 30;
    let count = Math.floor(this.fraction + 1e-8);
    // A slow/hidden tab catches up on its own, never holding up the other players.
    if (catchingUp) count = Math.max(count, this.pendingTicks - 6);
    count = Math.min(count, this.pendingTicks, 240);
    let played = 0;
    while (played < count && hasBudget()) {
      step(this.steps[this.head++], catchingUp);
      played++;
    }
    this.fraction = Math.max(0, this.fraction - played);
    if (!this.pendingTicks) this.fraction = 0;
    if (this.head > 512) { this.steps = this.steps.slice(this.head); this.head = 0; }
    return played;
  }
}
