import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      userId?: string;
      id?: string;
      email?: string;
      sid?: string;
    };
  }
}
