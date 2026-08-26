---
title: Emit Socket.IO updates from persisted state
impact: HIGH
tags: socketio, realtime, capacity
---

Socket.IO is a notification channel, not the source of truth. Emit a compact event payload after persistence, including event ID, confirmed count, capacity, and any user-visible status change. Clients refresh or reconcile from the API when needed.

Do not increment capacity optimistically in multiple browser clients and do not let socket handlers decide RSVP outcomes.
