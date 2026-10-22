import fs from 'fs'
import path from 'path'
import { createClient } from './client'

async function migrate() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  const sql = createClient(url)

  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  const applied = await sql<{ name: string }[]>`
    SELECT name FROM _migrations ORDER BY name
  `
  const appliedSet = new Set(applied.map(r => r.name))

  const migrationsDir = path.join(__dirname, '../migrations')
  const files = fs.readdirSync(migrationsDir).sort()
  const pending = files.filter(f => f.endsWith('.sql') && !appliedSet.has(f))

  if (pending.length === 0) {
    console.log('Nothing to migrate.')
    await sql.end()
    return
  }

  for (const file of pending) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    await sql.begin(async sql => {
      await sql.unsafe(content)
      await sql`INSERT INTO _migrations (name) VALUES (${file})`
    })
    console.log(`✓ ${file}`)
  }

  await sql.end()
}

migrate().catch(err => {
  console.error(err)
  process.exit(1)
})
