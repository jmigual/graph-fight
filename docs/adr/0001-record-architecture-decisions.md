# 1. Record architecture decisions

Status: Accepted (2026-11-09)

## Context

The game is being finished from a ~1000-line prototype: a Rust engine compiled to WASM plus a
TypeScript client, serverless P2P multiplayer, deployed as a static site. Several cross-cutting
choices (determinism, wire protocol, field geometry) must stay consistent across many commits
and agents.

## Decision

Record every architectural decision as a short ADR in `docs/adr/NNNN-kebab-title.md` using the
Michael Nygard format (Title, Status, Context, Decision, Consequences), each well under a page.
Anyone implementing the plan who makes a decision the existing ADRs do not settle (a new
dependency, a protocol field, a changed constant that affects outcomes, a known limitation
accepted) adds a new ADR in the same commit. A replaced decision gets
`Status: Superseded by NNNN`; it is not deleted. Each new ADR also adds a row to the index in
`docs/adr/README.md`.

## Consequences

- Reviewers can check a change against the recorded decisions instead of reverse-engineering
  intent.
- Small overhead per real decision; trivial implementation details do not get ADRs.
