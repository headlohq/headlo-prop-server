import type { PropServiceDef } from './types.js'

// The object returned by api.session.join({ roomId })
export interface SessionHandle {
  send(msg: Record<string, any>): void
  on(type: string, handler: (payload: Record<string, any>) => void): void
  leave(): void
  readonly id: string  // the roomId this handle is connected to
}

// realtime-session — Service PROP
//
// Interface for real-time WebSocket room management.
// Components join a named room and exchange messages with other connected clients.
// The underlying transport (Durable Object, Ably, Soketi) is invisible to the component.

export const realtimeSessionDef = {
  slug:  'realtime-session',
  prop_type: 'service',
  name:  'Realtime Session',
  stage: 'draft',
  contract: {
    config_fields: [
      { name: 'provider',   type: 'string', label: 'Provider (cf-do | ably | soketi)' },
      { name: 'soketi_url', type: 'string', label: 'Soketi endpoint (provider: soketi)' },
    ],
    actions: [
      {
        name:    'join',
        args:    { roomId: 'string' },
        returns: 'SessionHandle',
      },
      {
        name:    'leave',
        args:    { roomId: 'string' },
        returns: { ok: 'boolean' },
      },
    ],
    service_types: {
      SessionHandle: {
        kind: 'interface',
        methods: {
          send:  { args: { msg: 'Record<string, any>' }, returns: 'void' },
          on:    { args: { type: 'string', handler: '(payload: Record<string, any>) => void' }, returns: 'void' },
          leave: { args: {}, returns: 'void' },
        },
        properties: {
          id: 'string',
        },
      },
    },
  },
  handlers: {
    join:  { updates_state: [] },
    leave: { updates_state: [] },
  },
} satisfies PropServiceDef

// Implementations are separate defs: realtime-session-cf, realtime-session-ably, realtime-session-soketi

// Provider matrix — each implements join/leave without leaking:
//
//   join({ roomId }):
//     cf-durable-object → ws.connect(DO route)   → session handle
//     ably-prod         → channel.attach()        → session handle
//     soketi-self       → pusher.subscribe(room)  → session handle
//
//   session.send({ type, ...payload }):
//     cf-durable-object → ws.send(JSON.stringify(msg))
//     ably-prod         → channel.publish(type, payload)
//     soketi-self       → pusher.trigger(roomId, type, payload)
//
//   session.on(type, handler):
//     cf-durable-object → ws.onmessage, filter by msg.type
//     ably-prod         → channel.subscribe(type, handler)
//     soketi-self       → pusher.bind(type, handler)
//
//   leave({ roomId }):
//     cf-durable-object → ws.close()
//     ably-prod         → channel.detach()
//     soketi-self       → pusher.unsubscribe(roomId)

// Component code (StonkRacer race component):
//
//   const session = await api.session.join({ roomId: raceId })
//
//   session.send({ type: 'pos', x, y, angle, speed })
//
//   session.on('pos', ({ playerId, x, y, angle }) => {
//     world.updateGhost(playerId, x, y, angle)
//   })
//
//   // on unmount:
//   session.leave()
