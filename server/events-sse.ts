import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { type CommandEvent, onCommand } from '../src/data/events'

/**
 * SSE fan-out: every CommandEvent streams to all connected clients — the
 * reactivity channel that replaces Dexie liveQuery. Registered as a function
 * (not an import-time side effect) and called once from the app wiring.
 */
export function registerEvents(app: Hono): void {
  const clients = new Set<(event: CommandEvent) => void>()
  onCommand((event) => {
    for (const emit of clients) emit(event)
  })

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const emit = (event: CommandEvent) => void stream.writeSSE({ data: JSON.stringify(event) })
      clients.add(emit)
      // Hold the connection open; periodic pings keep proxies from closing it. A
      // cleared interval (not a re-arming sleep loop) means abort leaves no live
      // timer or dangling await — the connection tears down promptly.
      const ping = setInterval(() => void stream.writeSSE({ data: '', event: 'ping' }), 30_000)
      const done = new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clients.delete(emit)
          clearInterval(ping)
          resolve()
        })
      })
      await done
    }),
  )
}
