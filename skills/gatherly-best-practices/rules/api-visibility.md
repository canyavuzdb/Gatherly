---
title: Separate discovery visibility from join policy
impact: CRITICAL
tags: visibility, privacy, api
---

`Public`, `Unlisted`, and `Private` decide who can discover or view an event. `Open`, `Approval Required`, and `Invite Only` decide how a permitted viewer may join. Never treat an unlisted link as authorization for private attendee data, and never infer invite permission merely from visibility.
