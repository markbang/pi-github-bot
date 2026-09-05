import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { StoredTask } from "./db.js";

type RedisConnection = Redis;

export function createRedis(url: string): RedisConnection {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

export function createTaskQueue(connection: RedisConnection): Queue<StoredTask> {
  return new Queue<StoredTask>("pi-github-tasks", {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000, removeOnFail: 2000 }
  });
}
