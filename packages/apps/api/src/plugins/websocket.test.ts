import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { WebSocket } from 'ws';
import websocketPlugin from './websocket.js';

const state = vi.hoisted(() => ({ active: true, count: vi.fn() }));
vi.mock('../config/database.js', () => ({ prisma: { brand: { count: state.count } } }));
vi.mock('../services/session.service.js', () => ({
  SessionService: { getSessionById: vi.fn(async () => (state.active ? { id: 'session' } : null)) },
}));

let app: FastifyInstance;
let address: string;
const sockets: WebSocket[] = [];
const nextMessage = (socket: WebSocket) =>
  new Promise<Record<string, unknown>>((resolve) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
async function connect(
  payload: Record<string, unknown> = { id: 'alice', email: 'alice@example.test', sid: 'session' }
) {
  const token = app.jwt.sign(payload, payload.exp ? {} : { expiresIn: '1h' });
  const socket = new WebSocket(address.replace('http', 'ws') + '/ws', {
    headers: { cookie: `auth_token=${token}` },
  });
  sockets.push(socket);
  const message = await nextMessage(socket);
  return { socket, message };
}
async function send(socket: WebSocket, message: unknown) {
  const response = nextMessage(socket);
  socket.send(JSON.stringify(message));
  return response;
}

beforeEach(async () => {
  state.active = true;
  state.count.mockReset();
  state.count.mockImplementation(async ({ where }) =>
    where.userId === 'alice' ? where.id.in.filter((id: string) => id === 'owned').length : 0
  );
  app = Fastify();
  await app.register(jwt, {
    secret: 'test-only-32-character-secret-for-ws',
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });
  await app.register(websocketPlugin);
  address = await app.listen({ host: '127.0.0.1', port: 0 });
});
afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.terminate());
  await app.close();
});

describe('cookie-authenticated WebSocket subscriptions', () => {
  it('subscribes to owned brands and the authenticated user room and receives broadcasts', async () => {
    const { socket, message } = await connect();
    expect(message.type).toBe('authenticated');
    expect(
      await send(socket, { type: 'subscribe', rooms: ['brand:owned', 'user:alice'] })
    ).toMatchObject({ type: 'subscribed' });
    const received = nextMessage(socket);
    app.broadcastToRoom('brand:owned', { type: 'status_update', id: 'post-1' });
    expect(await received).toMatchObject({ id: 'post-1' });
    expect(await send(socket, { type: 'unsubscribe' })).toMatchObject({ type: 'unsubscribed' });
  });
  it.each([
    { rooms: ['brand:victim'] },
    { rooms: ['user:victim'] },
    { rooms: ['brand:owned', 'brand:victim'] },
    { brandId: 'victim' },
    { rooms: ['admin:all'] },
    { rooms: [null] },
  ])('rejects unauthorized or malformed room selections: %j', async (selection) => {
    const { socket } = await connect();
    expect(await send(socket, { type: 'subscribe', ...selection })).toMatchObject({
      type: 'error',
    });
    // A legitimate subscription still works after the rejected request.
    expect(await send(socket, { type: 'subscribe', brandId: 'owned' })).toMatchObject({
      type: 'subscribed',
    });
  });
  it('rejects revoked sessions at connection and revalidates subsequent messages', async () => {
    const { socket } = await connect();
    state.active = false;
    expect(await send(socket, { type: 'subscribe', brandId: 'owned' })).toMatchObject({
      type: 'error',
    });
    expect((await connect()).message.type).toBe('error');
  });
  it('rejects expired tokens and incomplete identity claims', async () => {
    expect((await connect({ id: 'alice', email: 'alice@example.test', exp: 1 })).message.type).toBe(
      'error'
    );
    expect((await connect({ id: 'alice' })).message.type).toBe('error');
  });
  it('keeps separate sockets subscribed and handles heartbeat acknowledgements', async () => {
    const a = await connect();
    const b = await connect();
    await send(a.socket, { type: 'subscribe', rooms: ['user:alice'] });
    await send(b.socket, { type: 'subscribe', rooms: ['user:alice'] });
    const received = [nextMessage(a.socket), nextMessage(b.socket)];
    app.broadcastToRoom('user:alice', { type: 'notification_created' });
    expect((await Promise.all(received)).map((message) => message.type)).toEqual([
      'notification_created',
      'notification_created',
    ]);
    expect(await send(a.socket, { type: 'ping' })).toEqual({ type: 'pong' });
  });
});

it.each(['unsubscribe', 'subscribe'] as const)(
  'a later %s supersedes a pending subscription',
  async (type) => {
    const { socket } = await connect();
    let finish!: (count: number) => void;
    state.count.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        })
    );
    socket.send(JSON.stringify({ type: 'subscribe', brandId: 'owned' }));
    await vi.waitFor(() => expect(state.count).toHaveBeenCalledOnce());
    expect(await send(socket, { type, rooms: ['user:alice'] })).toMatchObject({
      type: type === 'subscribe' ? 'subscribed' : 'unsubscribed',
    });
    finish(1);
    expect(await send(socket, { type: 'ping' })).toEqual({ type: 'pong' });
    app.broadcastToRoom('brand:owned', { type: 'unexpected_old_room' });
    expect(await send(socket, { type: 'ping' })).toEqual({ type: 'pong' });
    if (type === 'subscribe') {
      const response = nextMessage(socket);
      app.broadcastToRoom('user:alice', { type: 'current_room' });
      expect(await response).toEqual({ type: 'current_room' });
    }
  }
);
it('removes a subscribed socket immediately when session revocation is detected', async () => {
  const { socket } = await connect();
  await send(socket, { type: 'subscribe', brandId: 'owned' });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  state.active = false;
  expect(await send(socket, { type: 'ping' })).toMatchObject({ type: 'error' });
  await closed;
  expect(socket.readyState).toBe(WebSocket.CLOSED);
});
it('does not authorize a brand owned by a different user', async () => {
  const { socket } = await connect({ id: 'bob', email: 'bob@example.test', sid: 'session' });
  expect(await send(socket, { type: 'subscribe', brandId: 'owned' })).toMatchObject({
    type: 'error',
  });
  expect(state.count).toHaveBeenCalledWith({ where: { id: { in: ['owned'] }, userId: 'bob' } });
});
