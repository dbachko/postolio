import '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      userId?: string;
      id?: string;
      email?: string;
      sid?: string;
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateService: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export {};
