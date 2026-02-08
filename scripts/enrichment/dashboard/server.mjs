#!/usr/bin/env node
/**
 * Simple Express server for enrichment dashboard
 * Serves the HTML dashboard and API endpoint
 *
 * Usage:
 *   node server.mjs
 *   # Then open http://localhost:3456
 */

import express from 'express'
import { getStatus } from './api.mjs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.DASHBOARD_PORT || 3456

const app = express()

// Serve the HTML dashboard
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'))
})

// API endpoint
app.get('/api/status', async (req, res) => {
  try {
    const status = await getStatus()
    res.json(status)
  } catch (err) {
    console.error('API error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`🍕 Dashboard running at http://localhost:${PORT}`)
  console.log(`   API: http://localhost:${PORT}/api/status`)
})
