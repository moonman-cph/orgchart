'use strict';

const express = require('express');
const db      = require('../../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const log = await db.getChangelog();

    const { correlationId, entityType, entityId, field, operation, source, bulkId, from, to, isSensitive } = req.query;
    const limit  = Math.min(parseInt(req.query.limit  || '200', 10), 1000);
    const offset = parseInt(req.query.offset || '0', 10);

    // Filter
    let filtered = log;
    if (correlationId)      filtered = filtered.filter(e => e.correlationId === correlationId);
    if (entityType)         filtered = filtered.filter(e => e.entityType === entityType);
    if (entityId)           filtered = filtered.filter(e => e.entityId === entityId);
    if (field)              filtered = filtered.filter(e => e.field === field);
    if (operation)          filtered = filtered.filter(e => e.operation === operation);
    if (source)             filtered = filtered.filter(e => e.source === source);
    if (bulkId)             filtered = filtered.filter(e => e.bulkId === bulkId);
    if (from)               filtered = filtered.filter(e => e.timestamp >= from);
    if (to)                 filtered = filtered.filter(e => e.timestamp <= to);
    if (isSensitive !== undefined) {
      const flag = isSensitive === 'true';
      filtered = filtered.filter(e => e.isSensitive === flag);
    }

    const total = filtered.length;
    filtered.reverse(); // newest first so limit always returns the most recent entries
    const page  = filtered.slice(offset, offset + limit);

    res.json({ total, limit, offset, entries: page });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const log = await db.getChangelog();

    const days = parseInt(req.query.days || '30', 10);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const recent = log.filter(e => e.timestamp >= since);

    // Counts by day
    const byDayMap = {};
    for (const e of recent) {
      const day = e.timestamp.slice(0, 10);
      byDayMap[day] = (byDayMap[day] || 0) + 1;
    }
    const byDay = Object.entries(byDayMap).sort().map(([date, count]) => ({ date, count }));

    // Counts by entity type
    const byEntityType = {};
    for (const e of recent) {
      if (e.entityType) byEntityType[e.entityType] = (byEntityType[e.entityType] || 0) + 1;
    }

    // Counts by operation
    const byOperation = {};
    for (const e of recent) {
      byOperation[e.operation] = (byOperation[e.operation] || 0) + 1;
    }

    // Recent save batches (one entry per correlationId, using first entry's timestamp)
    const batchMap = {};
    for (const e of log) {
      if (!batchMap[e.correlationId]) {
        batchMap[e.correlationId] = {
          correlationId: e.correlationId,
          timestamp:     e.timestamp,
          source:        e.source,
          bulkId:        e.bulkId,
          changeReason:  e.changeReason,
          entryCount:    0,
          hasSensitive:  false,
        };
      }
      batchMap[e.correlationId].entryCount++;
      if (e.isSensitive) batchMap[e.correlationId].hasSensitive = true;
    }
    const recentBatches = Object.values(batchMap)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 50);

    res.json({ byDay, byEntityType, byOperation, recentBatches });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
