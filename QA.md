# AEROCK workflow QA — 2026-11-02

## Scope and limits

Five independent authenticated database identities in isolated PostgreSQL: president, leader1, member1, member2, member3. The test database has the production RPC, authenticated role, RLS, and separate JWT subject values. These are simulated database identities, not five Kakao accounts or successful OAuth sign-ins. No real member data was modified. Production write QA using existing actors was rejected by automatic approval review and was not executed. New disposable test accounts are needed for actual browser authentication and multi-session realtime verification.

The agreed flow has no in-app voting: officers discuss and select in Kakao, then the president records the selection result. This QA does not introduce voting.

## Reproduced defects and fixes

| Severity | Reproduction | Fix |
|---|---|---|
| High | Import a freeform song into a performance; deselect a previously occupied part; the removed part's participant remains invisibly in entries | Copy only entries for parts retained on the form; reject deleted source songs |
| High | Register two songs with different participants at the same time in the same room, inside one booking | Check room conflicts within a booking, in addition to participant conflicts |
| High | Book two songs separately, then confirm a participant who is already booked on the other song at the same time | Serialize participant and booking mutations and reject the conflicting confirmation; membership changes invalidate rehearsal acknowledgements |
| Medium | Open an existing rehearsal, cancel it elsewhere, then submit an acknowledgement for the cancelled schedule | Reject responses for cancelled rehearsals on the server |
| Medium | Select multiple songs and one recommended time; all songs receive the identical interval | Recommend the combined duration and populate consecutive per-song intervals |
| Medium | Edit different slots on two devices; the second save hits a revision conflict and cannot preserve both | Three-way merge unrelated edits, retry once; conflicting cells retain local input and require an explicit second save |
| Medium | Mutation succeeds but the subsequent read fails; UI reports failure and invites duplicate creation | Retain the acknowledged server record and show completion; refresh remaining data later |
| Low | Save a sample timetable and see a misleading server-save message | Clearly state that sample data is saved in this browser |

## Validation

- `node --test core.test.cjs schedule.test.cjs workflow.test.cjs`: 23 tests, including the five-identity lifecycle and regressions.
- `node db.test.cjs`: role restrictions, pending membership, stale revisions, ownership, session lifecycle, booking conflict and RLS assertions.
- `workflow-fixes.sql`: replace the existing RPC only; no table resets or member edits.
- Actual multi-account Kakao browser flow and current mobile interaction remain pending separate verification.
