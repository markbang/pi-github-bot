import { Pool } from "pg";
import type { TaskKind, TaskPayload } from "./types.js";

export interface StoredTask {
  id: string;
  payload: TaskPayload;
}

export function createDatabase(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
}

export async function ensureDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS processed_deliveries (
      delivery_id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id TEXT NOT NULL, kind TEXT NOT NULL,
      owner TEXT NOT NULL, repo TEXT NOT NULL, issue_number INTEGER NOT NULL, payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, UNIQUE (delivery_id, kind)
    );
    CREATE TABLE IF NOT EXISTS repository_settings (
      owner TEXT NOT NULL, repo TEXT NOT NULL, settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (owner, repo)
    );
    CREATE INDEX IF NOT EXISTS tasks_status_created_idx ON tasks (status, created_at);
  `);
}

export async function claimDelivery(pool: Pool, deliveryId: string): Promise<boolean> {
  const result = await pool.query("INSERT INTO processed_deliveries (delivery_id) VALUES ($1) ON CONFLICT DO NOTHING", [deliveryId]);
  return result.rowCount === 1;
}

export async function createTask(pool: Pool, payload: TaskPayload): Promise<StoredTask | null> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tasks (delivery_id, kind, owner, repo, issue_number, payload)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (delivery_id, kind) DO NOTHING RETURNING id`,
    [payload.deliveryId, payload.kind, payload.owner, payload.repo, payload.issueNumber, payload]
  );
  const row = result.rows[0];
  return row ? { id: row.id, payload } : null;
}

export async function startTask(pool: Pool, id: string): Promise<void> {
  await pool.query("UPDATE tasks SET status = 'running', started_at = NOW() WHERE id = $1", [id]);
}

export async function finishTask(pool: Pool, id: string, status: "succeeded" | "failed", error?: string): Promise<void> {
  await pool.query("UPDATE tasks SET status = $2, error = $3, finished_at = NOW() WHERE id = $1", [id, status, error ?? null]);
}

export async function getRepositorySettings(pool: Pool, owner: string, repo: string): Promise<Record<string, unknown>> {
  const result = await pool.query<{ settings: Record<string, unknown> }>("SELECT settings FROM repository_settings WHERE owner = $1 AND repo = $2", [owner, repo]);
  return result.rows[0]?.settings ?? {};
}

export async function saveRepositorySettings(pool: Pool, owner: string, repo: string, settings: Record<string, unknown>): Promise<void> {
  await pool.query(
    `INSERT INTO repository_settings (owner, repo, settings) VALUES ($1, $2, $3)
     ON CONFLICT (owner, repo) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
    [owner, repo, settings]
  );
}

export function isTaskKind(value: string): value is TaskKind {
  return value === "mention" || value === "issue_triage" || value === "pr_review";
}
