import type { GnosisDB } from '../db'
import type { StoreEvent } from '../events'
import type { Command } from './types'

/**
 * One composite = one undo step. The body runs each sub-command through `run`,
 * which records it in order; undo replays the recorded commands in reverse. do()
 * is re-runnable (redo): it resets its capture and recomputes from current state.
 *
 * `cascade` may be a function for composites whose destructiveness is only known
 * mid-do() (e.g. a DSL apply that may or may not remove nodes); the dispatcher
 * reads `cascade` after do() resolves.
 */
export function composite(
  label: string,
  body: (run: (command: Command) => Promise<void>, db: GnosisDB) => Promise<void>,
  opts: { cascade?: boolean | (() => boolean) } = {},
): Command {
  let executed: Command[] = []
  return {
    label,
    get cascade() {
      return typeof opts.cascade === 'function' ? opts.cascade() : opts.cascade ?? false
    },
    async do(db) {
      executed = []
      const events: StoreEvent[] = []
      const run = async (command: Command) => {
        events.push(...(await command.do(db)))
        executed.push(command)
      }
      await body(run, db)
      return events
    },
    async undo(db) {
      const events: StoreEvent[] = []
      for (const command of [...executed].reverse()) {
        events.push(...(await command.undo(db)))
      }
      return events
    },
  }
}
