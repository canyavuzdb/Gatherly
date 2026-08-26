---
title: Enforce organizer ownership for event management
impact: CRITICAL
tags: authorization, organizer, invitations
---

Creating an event makes its creator the organizer for that event only. Approval, rejection, invitation, editing, cancellation, and attendee-list access require ownership of the target event. A valid JWT proves identity but never proves organizer permission by itself.

Apply authorization before a mutation and return a forbidden response without revealing private attendee data.
