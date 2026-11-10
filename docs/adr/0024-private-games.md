# 24. Private games: password or private link

Status: Accepted (2026-11-10). Amends 0012 (lobby listing, game rooms), 0015 (host form, join flow),
0016 (stored seat), 0017 (lobby, waiting room) and 0018 (a join timeout for guests without a seat).

## Context

Every game was public: listed in the lobby to anyone on the same build, and open to anyone who
clicked Join. Players want games only their friends can join, by a password or by a link. Peers
connect over Trystero (ADR 6, 12), whose signalling goes through public Nostr relays; Trystero 0.26.0
has a room `password` option that encrypts the session descriptions with a key derived from it, so
peers with different passwords cannot connect. A kick (ADR 23) cannot keep someone out of a public
game, since a reload brings a new peer id.

## Decision

- **Host form.** "Visibility": Public (the default, as before), Password or Private link. Password
  shows a "Password" field (required, at most 64 characters); CSS hides it otherwise, like Seats.
  Both password fields, here and in the join dialog, are masked (`type="password"`) and have a
  **Show** toggle button next to them (`aria-label="Show password"`, `aria-pressed`) that reveals the
  text. The dialog's field is masked again each time it opens.
- **Room password.** A password or private-link game joins its room `game-<hostId>` with
  `joinRoom({appId, password})`, on the host and on every guest. A guest with another password never
  connects: Trystero cannot decrypt the other side's offers. There is no extra check message.
- **Password strength.** Trystero 0.26.0 derives its AES key from a single SHA-256 of
  `password:appId:roomId`. The encrypted offers sit on public Nostr relays and the listing names the
  room, so anyone can collect an offer and test guesses offline at SHA-256 speed, and a short human
  password falls quickly. A typed password is therefore stretched before `joinRoom`, on the host when
  it hosts and on a guest when it joins: `stretchPassword` runs WebCrypto PBKDF2-SHA256 with the salt
  `graph-fight:game-<hostId>` and 200 000 iterations into 256 bits, and the hex of those bits is the
  room password. That took 83 ms in desktop Chromium (WebCrypto runs natively, so DevTools CPU
  throttling does not slow it); phones with a few times slower SHA-256 should take about 150 to
  300 ms. Each offline guess now costs 200 000 SHA-256 rounds more. A private link's key is 128 random
  bits, which no guessing reaches, so it is used as it is. No dependency is added.
- **Password games** are listed with `locked: true`. `parseListing` requires a boolean `locked`; a
  listing from another build may lack it and reads as unlocked (it is only shown as another version).
  The lobby shows a padlock after the name (a CSS mask in the text colour, `role="img"`,
  `aria-label="Password required"`). Join opens a native modal `<dialog>` "Join with a password" with
  a labelled field, Join and Cancel (Escape also closes it), then joins with that password.
- **Private-link games** are never announced: the host never publishes a listing for them. The room
  password is 128 random bits from `crypto.getRandomValues` as hex (`newToken`, the seat tokens'
  generator).
- **Invite link.** The host of a password or private-link game sees, in the waiting room, the link in
  a read-only labelled field and a **Copy invite link** button. The link is
  `<origin><path>#join=<hostId>&key=<room password>&v=<build>`, built by `inviteFragment` with
  `URLSearchParams`: for a password game that is the stretched password, so the link never shows the
  typed one, and opening it skips the stretching. The key is in the fragment, so it never reaches a
  server. Copy uses
  `navigator.clipboard.writeText`; when that fails (no secure context, no permission) the field's text
  is selected for copying by hand. A polite status line says which.
- **Opening a link.** On load, and on `hashchange` (a link pasted into an open tab only changes the
  fragment), `parseInvite` reads the fragment. It is untrusted input: `join`, `key` and `v` must all
  be there, `join` and `key` non-empty, each at most 64 characters, or the fragment is ignored. The
  page always removes a valid fragment first with `history.replaceState`, so a screenshot or a copied
  address does not show the key. In the lobby or on the end screen it then joins at once; if `v` is
  not our build, it shows "Different version." and "Reload the page, then open the invite link again."
  (the fragment is gone, so the link has to be opened again) instead of joining. In a game or a
  waiting room it stays where it is and says "Finish or leave this game first, then open the invite
  link again." in the game's error line or the waiting room's. Removing the fragment there matters: a
  reload would otherwise follow the link instead of rejoining the seat (ADR 16). The link carries the
  version because the `start` gate (ADR 12) only turns a guest away once the game starts, and that
  guest would then hold a seat nobody plays. Leaving for the lobby also closes the password dialog,
  so a dialog left open cannot join a room from the hidden lobby.
- **Join timeout.** There was no connection timeout for a fresh join before: a guest whose host never
  answered waited in the waiting room for good. Now every guest joining without a seat, public or
  private, does what the ADR 18 watchdog does: if the host link has not come up after 25 s, it leaves
  and joins the room again, with fresh signalling state, so a slow or stalled relay gets a second
  chance; if the link is still not up 50 s later (75 s in all), it leaves the room and ends. With a
  password or a link key the message is "Wrong password, or the host can't be reached.", since a wrong
  password and a gone host look the same; a public join ends with "The host can't be reached.". The
  timer stops once the host link comes up.
- **Reconnection.** The stored seat (ADR 16) also keeps the room password (`key`, stretched for a
  password game), so a reload and the watchdog's rejoin (ADR 18) join the same room with it. It is in `sessionStorage` with the seat token,
  and is cleared with it.
- **Guests sharing the link.** The host decides whether guests may copy the invite link: the host
  form has a checkbox "Guests can share the invite link" (`#host-share`, off by default), shown for
  password and private-link games alike, which was simplest. When it is on, the host sends each guest
  `{type: "share"}` as the guest joins the waiting room, a targeted message outside the sequence like
  the seat token and the kick, accepted only from the host. The guest then shows the same invite link
  and Copy button. A boolean in `start` was considered and rejected: `start` arrives when the waiting
  room closes, and nobody can join a game after that (ADR 15, "game full"), so the link would only show
  once it is useless.
- **Unchanged.** The live and dev lobby topics (ADR 12), the game-room name, the relayed protocol and
  the engine.

Rejected:
- A password check message from the host: it would need a handshake before the room's normal
  messages, and the room password already stops a wrong one from connecting at all.
- Trystero's `onJoinError` callback for an immediate "Wrong password": it also fires for other
  failures (no TURN server, handshake timeouts), only as an error string, and only after the
  encrypted offers have met. The timeout covers a gone host as well.
- Putting the password into the room name instead: anyone reading a listing or a relay would see
  peers meet, and ADR 12's room naming would change for no gain.
- `window.prompt` for the password: it is blocking and has no label of ours.
- Plain, always visible password fields: a password typed in front of others, or on a shared screen
  (ADR 22), should not be on show by default; the toggle covers checking what was typed.

## Consequences

- A private game cannot be found from the lobby without the password or the link. The relays only see
  encrypted session descriptions, as before.
- Someone who knows the password or has the link can always join while the game waits, even after a
  kick under a new peer id (ADR 23); the host then hosts a new game with a new secret.
- A wrong password costs the guest 75 s before the message. A correct one on a slow relay gets a
  second signalling round before it is called wrong.
- Tests: `tests/net.test.mjs` (`locked`, `share` only from the host, `parseInvite`,
  `inviteFragment`, `newToken`, `stretchPassword` against Node's `pbkdf2Sync` with the same
  parameters); e2e AB (a password game joined with the right password, refused with a wrong one after
  one more join of the room, masked fields, guests not sharing, and a guest reload), AF (a public join
  to a host that is gone) and AC (a private-link game absent from the lobby and the host's published
  events, its link copied, shared with the guests, joined by loading it and by pasting it into an
  open lobby, and pasted again mid-game: the address bar is cleaned and a reload rejoins the seat).
