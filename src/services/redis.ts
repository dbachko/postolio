import { Redis } from 'ioredis'

class RedisService {
  private client: Redis | null = null

  constructor() {
    this.connect()
  }

  private connect() {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
      this.client = new Redis(redisUrl, {
        enableReadyCheck: true,
        lazyConnect: true,
      })

      this.client.on('error', (err) => {
        console.error('Redis connection error:', err)
      })

      this.client.on('connect', () => {
        console.log('Connected to Redis')
      })
    } catch (error) {
      console.warn('Redis connection failed, falling back to in-memory storage:', error)
      this.client = null
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) {
      return null
    }

    try {
      return await this.client.get(key)
    } catch (error) {
      console.error('Redis GET error:', error)
      return null
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    if (!this.client) {
      return false
    }

    try {
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, value)
      } else {
        await this.client.set(key, value)
      }
      return true
    } catch (error) {
      console.error('Redis SET error:', error)
      return false
    }
  }

  async del(key: string): Promise<boolean> {
    if (!this.client) {
      return false
    }

    try {
      await this.client.del(key)
      return true
    } catch (error) {
      console.error('Redis DEL error:', error)
      return false
    }
  }

  async increment(key: string, ttlSeconds?: number): Promise<number | null> {
    if (!this.client) {
      return null
    }

    try {
      const count = await this.client.incr(key)
      if (ttlSeconds && count === 1) {
        await this.client.expire(key, ttlSeconds)
      }
      return count
    } catch (error) {
      console.error('Redis INCR error:', error)
      return null
    }
  }

  isConnected(): boolean {
    return this.client?.status === 'ready'
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit()
      this.client = null
    }
  }
}

export const redisService = new RedisService()
